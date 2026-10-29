// O PINEON quase não traz regras fixas: cada unidade/prestador tem as suas e
// as cria em Regras personalizadas. Este arquivo (1) lê o lote, (2) calcula os
// totais exibidos em "Resumo de Contas", (3) aplica as regras que o usuário
// cadastrou — cada regra vale pra todos os prestadores ou só pra alguns (ver
// regraValeParaPrestador), e roda por guia ou por item — e (4) confere a única
// regras fixas que ficaram: data de execução fora do período da conta e
// divergência financeira (a soma tem que bater, ao centavo, em cada nível:
// itens -> categorias -> total da guia -> total do lote).
import { getElementsByLocalName, getTagVal, findLineNumber } from '../utils/xml.js';
import { parseDate } from '../utils/date.js';
import { formatMoneyBR } from '../utils/format.js';
import { getRegras, avaliarRegra, descreverRegra, regraValeParaPrestador } from '../regrasPersonalizadas.js';

// Faixa de linhas (1-based, inclusive) que a guia ocupa no XML, a partir da
// linha do identificador dela. Usada pelas regras personalizadas pra procurar
// tags DENTRO da guia certa — buscar só "a partir daqui pra frente" cairia na
// guia seguinte quando a tag procurada vem antes do identificador.
function delimitarGuia(linesArray, nomeTag, linhaId) {
    const abre = new RegExp(`<(?:[\\w-]+:)?${nomeTag}[\\s>]`);
    const fecha = new RegExp(`</(?:[\\w-]+:)?${nomeTag}\\s*>`);
    let inicio = linhaId;
    for (let i = linhaId - 1; i >= 0; i--) {
        if (abre.test(linesArray[i])) { inicio = i + 1; break; }
    }
    let fim = linesArray.length;
    for (let i = Math.max(linhaId - 1, 0); i < linesArray.length; i++) {
        if (fecha.test(linesArray[i])) { fim = i + 1; break; }
    }
    return { inicio, fim };
}

// Linha (1-based) da primeira abertura da tag dentro da faixa, ou null.
function acharTagNaFaixa(linesArray, tag, inicio, fim) {
    const abre = new RegExp(`<(?:[\\w-]+:)?${tag}[\\s>]`);
    for (let i = Math.max(inicio - 1, 0); i < Math.min(fim, linesArray.length); i++) {
        if (abre.test(linesArray[i])) return i + 1;
    }
    return null;
}

// Nome da tag no XML a partir do campo da regra ("pai/filho" -> "filho").
const nomeDaTag = (campo) => String(campo).split('/').pop();

// Elementos com o nome do campo dentro de `raiz`, em ordem de documento. Se o
// campo é um caminho "pai/filho", só os que têm esses ancestrais (em ordem,
// não necessariamente imediatos) — é o que separa, por exemplo, o
// codigoPrestadorNaOperadora do executante do do solicitante.
function buscarElementos(raiz, campo) {
    const partes = String(campo).split('/');
    const nome = partes.pop();
    const pais = partes.reverse(); // do ancestral mais próximo ao mais distante
    return getElementsByLocalName(raiz, nome).filter(el => {
        if (!pais.length) return true;
        let i = 0;
        for (let p = el.parentNode; p && i < pais.length; p = p.parentNode) {
            if (p.localName === pais[i]) i++;
            if (p === raiz) break;
        }
        return i === pais.length;
    });
}

// Linha (1-based) de cada abertura de <nome> dentro da faixa, na ordem do XML.
function linhasDaTag(linesArray, nome, faixa) {
    const abre = new RegExp(`<(?:[\\w.-]+:)?${nome}(?=[\\s>/])`, 'g');
    const linhas = [];
    const limite = Math.min(faixa.fim, linesArray.length);
    for (let i = Math.max(faixa.inicio, 1) - 1; i < limite; i++) {
        const n = (linesArray[i].match(abre) || []).length;
        for (let k = 0; k < n; k++) linhas.push(i + 1);
    }
    return linhas;
}

// Valor em centavos inteiros, pra comparar dinheiro sem erro de arredondamento.
const centavos = (v) => Math.round((Number(v) || 0) * 100);

// Elementos que são "itens" de uma guia (procedimento, material, taxa...).
const ITENS_XML = new Set(['procedimentoExecutado', 'servicosExecutados', 'dadosAtendimento']);

// Faixa de linhas (1-based, inclusive) de UM item: da linha onde ele abre até
// a linha onde fecha, procurando só entre `desde` e `ate`. Retorna null se não
// achar (XML formatado de um jeito inesperado) — quem chama não deve oferecer
// correção automática nesse caso.
function delimitarItem(linesArray, localName, desde, ate) {
    const abre = new RegExp(`<(?:[\\w.-]+:)?${localName}(?=[\\s>/])`);
    const fecha = new RegExp(`</(?:[\\w.-]+:)?${localName}\\s*>`);
    const limite = Math.min(ate, linesArray.length);
    for (let i = Math.max(desde, 1) - 1; i < limite; i++) {
        const m = abre.exec(linesArray[i]);
        if (!m) continue;
        if (fecha.test(linesArray[i].slice(m.index))) return { inicio: i + 1, fim: i + 1 };
        for (let j = i + 1; j < limite; j++) {
            if (fecha.test(linesArray[j])) return { inicio: i + 1, fim: j + 1 };
        }
        return null;
    }
    return null;
}

// A tag está dentro de algum item da guia (e não no cabeçalho dela)?
function estaDentroDeItem(el, raiz) {
    for (let p = el.parentNode; p && p !== raiz; p = p.parentNode) {
        if (ITENS_XML.has(p.localName)) return true;
    }
    return false;
}

export function executeRuleEngine(xmlDoc, linesArray) {
    const results = {
        erros: [],
        alertas: [],
        guias: [],
        resumoLote: {},
        categorias: { fin: 0, datas: 0, estrut: 0 }
    };

    // Prestador do lote (o mesmo código mostrado no resumo e no relatório do
    // dia). Só valem as regras sem restrição de prestador ou que citam este.
    const prestadorLote = getTagVal(xmlDoc, 'codigoPrestadorNaOperadora');
    const regrasPersonalizadas = getRegras().filter(r => regraValeParaPrestador(r, prestadorLote));

    const guiasNodes = [
        ...getElementsByLocalName(xmlDoc, 'guiaResumoInternacao'),
        ...getElementsByLocalName(xmlDoc, 'guiaSP-SADT'),
        ...getElementsByLocalName(xmlDoc, 'guiaHonorarioIndividual'),
        ...getElementsByLocalName(xmlDoc, 'guiaConsulta')
    ];

    let somaTotalLoteCalculado = 0;

    // Cursor global usado para localizar a linha de cada guia. As guias são
    // processadas na mesma ordem em que aparecem no documento, então buscar
    // sempre a partir da última linha encontrada evita casar com o
    // identificador de uma guia posterior que reaproveite o mesmo texto.
    let cursorGlobal = 0;

    guiasNodes.forEach((guiaNode, idx) => {
        const guiaInternacao = getTagVal(guiaNode, 'numeroGuiaSolicitacaoInternacao');
        const guiaOperadora = getTagVal(guiaNode, 'numeroGuiaOperadora');
        const guiaPrestador = getTagVal(guiaNode, 'numeroGuiaPrestador');

        const identificadorGuia = guiaInternacao || guiaOperadora || guiaPrestador || `SEM-NUMERO-${idx+1}`;
        const numLinhaGuia = findLineNumber(linesArray, identificadorGuia, cursorGlobal);
        cursorGlobal = numLinhaGuia;
        // Faixa de linhas desta guia no XML: as regras procuram uma tag só aqui
        // dentro, pra uma tag ausente nunca "emprestar" a linha da guia seguinte.
        const faixaGuia = delimitarGuia(linesArray, guiaNode.localName, numLinhaGuia);
        const senha = getTagVal(guiaNode, 'senha');
        const carteirinha = getTagVal(guiaNode, 'numeroCarteira') || 'S/N';

        // guiaConsulta é bem mais simples que as demais: um único procedimento
        // solto em <dadosAtendimento>, com o valor em <valorProcedimento> e sem
        // despesas nem totais declarados separados.
        const tipoGuia = guiaNode.localName === 'guiaConsulta' ? 'consulta' : 'padrao';

        // Cursor local desta guia: avança a cada código encontrado, só pra que
        // o cursor global não retroceda antes do último item da guia.
        let cursorProc = numLinhaGuia;

        // 1. Procedimentos executados
        const procedimentos = tipoGuia === 'consulta'
            ? getElementsByLocalName(guiaNode, 'dadosAtendimento')
            : getElementsByLocalName(guiaNode, 'procedimentoExecutado');
        let somaProcedimentos = 0;

        // Itens da guia na ordem do XML (procedimentos, depois despesas), cada
        // um com a faixa de linhas dele — usados pela regra de data e pelas
        // regras personalizadas de nível "item".
        const itens = [];
        const cursoresItem = {};
        const registrarItem = (node, tag, seq, cod, desc) => {
            const faixa = delimitarItem(linesArray, tag, cursoresItem[tag] ?? faixaGuia.inicio, faixaGuia.fim);
            if (faixa) cursoresItem[tag] = faixa.fim + 1;
            itens.push({ node, faixa, seq, cod, desc });
        };

        procedimentos.forEach(proc => {
            const codProc = getTagVal(proc, 'codigoProcedimento') || '-';
            const valTotal = tipoGuia === 'consulta'
                ? parseFloat(getTagVal(proc, 'valorProcedimento') || 0)
                : parseFloat(getTagVal(proc, 'valorTotal') || 0);
            cursorProc = findLineNumber(linesArray, codProc, cursorProc);
            somaProcedimentos += valTotal;
            registrarItem(
                proc,
                tipoGuia === 'consulta' ? 'dadosAtendimento' : 'procedimentoExecutado',
                getTagVal(proc, 'sequencialItem') || (tipoGuia === 'consulta' ? '1' : '-'),
                codProc,
                getTagVal(proc, 'descricaoProcedimento') || (tipoGuia === 'consulta' ? 'Consulta' : 'Procedimento sem descrição')
            );
        });

        // 2. Despesas / medicamentos / materiais / OPME
        const despesasNodes = getElementsByLocalName(guiaNode, 'despesa');
        const despesasCalc = { proc: somaProcedimentos, gases: 0, med: 0, mat: 0, dia: 0, tax: 0, opme: 0 };

        despesasNodes.forEach(desp => {
            const codDesp = getTagVal(desp, 'codigoDespesa');
            const servicos = getElementsByLocalName(desp, 'servicosExecutados');

            servicos.forEach(serv => {
                const codProc = getTagVal(serv, 'codigoProcedimento') || '-';
                const valDesp = parseFloat(getTagVal(serv, 'valorTotal') || 0);
                cursorProc = findLineNumber(linesArray, codProc, cursorProc);
                registrarItem(
                    serv,
                    'servicosExecutados',
                    getTagVal(serv, 'sequencialItem') || '-',
                    codProc,
                    getTagVal(serv, 'descricaoProcedimento') || 'Despesa sem descrição'
                );

                switch(codDesp) {
                    case '01': despesasCalc.gases += valDesp; break;
                    case '02': despesasCalc.med += valDesp; break;
                    case '03': despesasCalc.mat += valDesp; break;
                    case '05': despesasCalc.dia += valDesp; break;
                    case '07': despesasCalc.tax += valDesp; break;
                    case '08': despesasCalc.opme += valDesp; break;
                }
            });
        });

        cursorGlobal = Math.max(cursorGlobal, cursorProc);

        // guiaConsulta não tem totais declarados separados do calculado.
        const declarados = tipoGuia === 'consulta'
            ? { proc: somaProcedimentos, mat: 0, med: 0, dia: 0, tax: 0, opme: 0, gas: 0, totalGeral: somaProcedimentos }
            : {
                proc: parseFloat(getTagVal(guiaNode, 'valorProcedimentos') || 0),
                mat: parseFloat(getTagVal(guiaNode, 'valorMateriais') || 0),
                med: parseFloat(getTagVal(guiaNode, 'valorMedicamentos') || 0),
                dia: parseFloat(getTagVal(guiaNode, 'valorDiarias') || 0),
                tax: parseFloat(getTagVal(guiaNode, 'valorTaxasAlugueis') || 0),
                opme: parseFloat(getTagVal(guiaNode, 'valorOPME') || 0),
                gas: parseFloat(getTagVal(guiaNode, 'valorGasesMedicinais') || 0),
                totalGeral: parseFloat(getTagVal(guiaNode, 'valorTotalGeral') || 0)
            };

        const somaCalculadaGuia = despesasCalc.proc + despesasCalc.mat + despesasCalc.med
            + despesasCalc.dia + despesasCalc.tax + despesasCalc.opme + despesasCalc.gases;

        somaTotalLoteCalculado += declarados.totalGeral;

        // ── Regra fixa: divergência financeira ──
        // Compara em centavos inteiros: qualquer diferença de R$ 0,01 acusa, e o
        // ruído de ponto flutuante da soma (0,1 + 0,2) não gera falso erro.
        const checarDivergencia = (descricao, dec, calc, tag) => {
            if (centavos(dec) === centavos(calc)) return;
            const linha = acharTagNaFaixa(linesArray, tag, faixaGuia.inicio, faixaGuia.fim) ?? numLinhaGuia;
            results.erros.push({
                linha,
                guia: identificadorGuia,
                item: "-",
                codigo: "-",
                descricao: `Resumo - ${descricao}`,
                tipo: "Erro",
                categoria: "fin",
                mensagem: `Divergência financeira: Declarado ${formatMoneyBR(dec)} vs Calculado ${formatMoneyBR(calc)}.`,
                targetTag: tag
            });
            results.categorias.fin++;
        };
        checarDivergencia("valorProcedimentos", declarados.proc, despesasCalc.proc, 'valorProcedimentos');
        checarDivergencia("valorMateriais (03)", declarados.mat, despesasCalc.mat, 'valorMateriais');
        checarDivergencia("valorMedicamentos (02)", declarados.med, despesasCalc.med, 'valorMedicamentos');
        checarDivergencia("valorDiarias (05)", declarados.dia, despesasCalc.dia, 'valorDiarias');
        checarDivergencia("valorTaxasAlugueis (07)", declarados.tax, despesasCalc.tax, 'valorTaxasAlugueis');
        checarDivergencia("valorOPME (08)", declarados.opme, despesasCalc.opme, 'valorOPME');
        checarDivergencia("valorGasesMedicinais (01)", declarados.gas, despesasCalc.gases, 'valorGasesMedicinais');
        checarDivergencia("valorTotalGeral", declarados.totalGeral, somaCalculadaGuia, 'valorTotalGeral');

        // ── Regra fixa: data de execução fora do período da conta ──
        // (a guia de consulta não tem período de faturamento: não se aplica)
        const dtInicioFat = parseDate(getTagVal(guiaNode, 'dataInicioFaturamento'));
        const dtFimFat = parseDate(getTagVal(guiaNode, 'dataFinalFaturamento'));
        if (dtInicioFat && dtFimFat) {
            itens.forEach(item => {
                const dtExecStr = getTagVal(item.node, 'dataExecucao');
                const dtExec = parseDate(dtExecStr);
                if (!dtExec || (dtExec >= dtInicioFat && dtExec <= dtFimFat)) return;

                const linha = (item.faixa
                    ? acharTagNaFaixa(linesArray, 'dataExecucao', item.faixa.inicio, item.faixa.fim)
                    : null) ?? item.faixa?.inicio ?? numLinhaGuia;
                results.erros.push({
                    linha,
                    guia: identificadorGuia,
                    item: item.seq,
                    codigo: item.cod,
                    descricao: item.desc,
                    tipo: "Erro",
                    categoria: "datas",
                    mensagem: `Data de execução (${dtExecStr}) fora do período faturado.`,
                    targetTag: "dataExecucao"
                });
                results.categorias.datas++;
            });
        }

        // ── Regras personalizadas (definidas pelo usuário) ──
        // null = a tag nem existe (diferente de existir e estar vazia)
        const lerCampo = (campo) => {
            const el = buscarElementos(guiaNode, campo)[0];
            return el ? el.textContent.trim() : null;
        };

        // Faixa de linhas EXATA de uma ocorrência da tag: a k-ésima abertura de
        // <tag> dentro do escopo (guia ou item) é a linha dela. Se a contagem de
        // linhas não bate com a de elementos (XML fora do padrão de uma tag por
        // linha), só a 1ª ocorrência dá pra localizar — pela 1ª linha da faixa.
        const faixaDoElemento = (el, nome, escopoNode, escopoFaixa) => {
            if (!escopoFaixa) return null;
            const todos = getElementsByLocalName(escopoNode, nome);
            const idx = todos.indexOf(el);
            if (idx === -1) return null;
            const linhas = linhasDaTag(linesArray, nome, escopoFaixa);
            if (linhas.length === todos.length) return { inicio: linhas[idx], fim: linhas[idx] };
            return idx === 0 ? escopoFaixa : null;
        };

        // Resolvedores de "campo a corrigir": { valor, faixa } (faixa = onde a
        // correção pode mexer) ou null se o campo não existe nesse escopo.
        const alvoNaGuia = (campo) => {
            const el = buscarElementos(guiaNode, campo)[0];
            if (!el) return null;
            return { valor: el.textContent.trim(), faixa: faixaDoElemento(el, nomeDaTag(campo), guiaNode, faixaGuia) };
        };

        // Avalia UMA regra. `ler` lê os campos das condições; `resolverAlvo`
        // localiza o campo a corrigir; `faixaLinha` é onde procurar a linha do erro.
        const aplicarRegra = (regraP, ler, resolverAlvo, faixaLinha, meta) => {
            if (!avaliarRegra(regraP, ler)) return;

            const campo0 = regraP.condicoes[0].campo;
            const linhaRegra = (faixaLinha ? acharTagNaFaixa(linesArray, nomeDaTag(campo0), faixaLinha.inicio, faixaLinha.fim) : null)
                ?? faixaLinha?.inicio ?? numLinhaGuia;

            // Correção: valor fixo, ou cópia do valor de OUTRO campo (origemCorrigir).
            // O botão só aparece quando dá pra executar: o campo a corrigir precisa
            // existir e ter linha localizável (nunca se mexe na guia/item vizinho),
            // no modo cópia o campo de origem precisa ter valor, e o valor novo
            // precisa ser diferente do atual.
            let autoFix = null;
            if (regraP.campoCorrigir) {
                const alvo = resolverAlvo(regraP.campoCorrigir);
                const modoCopia = Boolean(regraP.origemCorrigir);
                const valorNovo = modoCopia ? ler(regraP.origemCorrigir) : regraP.valorCorrigir;
                const aplicavel = alvo && alvo.faixa
                    && valorNovo !== null && valorNovo !== undefined && valorNovo !== ''
                    && valorNovo !== alvo.valor;
                if (aplicavel) {
                    autoFix = {
                        campo: regraP.campoCorrigir,
                        tag: nomeDaTag(regraP.campoCorrigir),
                        valorNovo,
                        valorAtual: alvo.valor,
                        origem: modoCopia ? regraP.origemCorrigir : null,
                        inicioGuia: alvo.faixa.inicio,
                        fimGuia: alvo.faixa.fim
                    };
                }
            }

            const lista = regraP.severidade === 'Erro' ? results.erros : results.alertas;
            lista.push({
                linha: linhaRegra,
                guia: identificadorGuia,
                item: meta.item,
                codigo: meta.codigo,
                descricao: meta.descricao,
                tipo: regraP.severidade,
                categoria: "estrut",
                mensagem: regraP.mensagem || `Regra: ${descreverRegra(regraP)}.`,
                targetTag: nomeDaTag(campo0),
                autoFix
            });
            results.categorias.estrut++;
        };

        const metaGuia = { item: "-", codigo: "-", descricao: "Regra Personalizada" };

        // Nível "guia": uma vez por guia, lendo a 1ª ocorrência de cada campo.
        regrasPersonalizadas.filter(r => !r.nivel || r.nivel === 'guia').forEach(regraP => {
            // A linha do erro é a da ocorrência lida (importa quando a tag aparece
            // em vários lugares e a regra usa um caminho "pai/filho").
            const campo0 = regraP.condicoes[0].campo;
            const el0 = buscarElementos(guiaNode, campo0)[0];
            const faixa0 = el0 ? faixaDoElemento(el0, nomeDaTag(campo0), guiaNode, faixaGuia) : null;
            aplicarRegra(regraP, lerCampo, alvoNaGuia, faixa0 ?? faixaGuia, metaGuia);
        });

        // Nível "ocorrência": uma vez por ocorrência do 1º campo da condição
        // (ex.: cada codigoPrestadorNaOperadora da guia). O 1º campo vem daquela
        // ocorrência; os demais, da guia. Se o campo a corrigir é o próprio 1º
        // campo, a correção mexe exatamente na linha dessa ocorrência.
        regrasPersonalizadas.filter(r => r.nivel === 'ocorrencia').forEach(regraP => {
            const campo0 = regraP.condicoes[0].campo;
            buscarElementos(guiaNode, campo0).forEach(el => {
                const valorEl = el.textContent.trim();
                const faixaOc = faixaDoElemento(el, nomeDaTag(campo0), guiaNode, faixaGuia);
                const ler = (campo) => (campo === campo0 ? valorEl : lerCampo(campo));
                const resolver = (campo) => (campo === campo0 ? { valor: valorEl, faixa: faixaOc } : alvoNaGuia(campo));
                aplicarRegra(regraP, ler, resolver, faixaOc ?? faixaGuia, metaGuia);
            });
        });

        // Nível "item": uma vez por item. Os campos são lidos de dentro do próprio
        // item; o que não existe nele cai nos campos do cabeçalho da guia (ex.:
        // tipoFaturamento, regimeInternacao), nunca nos de outro item. O mesmo vale
        // pro campo a corrigir: dentro do item, senão no cabeçalho da guia.
        const regrasItem = regrasPersonalizadas.filter(r => r.nivel === 'item');
        if (regrasItem.length) {
            itens.forEach(item => {
                const localizar = (campo) => {
                    const doItem = buscarElementos(item.node, campo)[0];
                    if (doItem) return { el: doItem, node: item.node, faixa: item.faixa };
                    const doCabecalho = buscarElementos(guiaNode, campo).find(e => !estaDentroDeItem(e, guiaNode));
                    return doCabecalho ? { el: doCabecalho, node: guiaNode, faixa: faixaGuia } : null;
                };
                const lerItem = (campo) => {
                    const r = localizar(campo);
                    return r ? r.el.textContent.trim() : null;
                };
                const alvoItem = (campo) => {
                    const r = localizar(campo);
                    return r ? { valor: r.el.textContent.trim(), faixa: faixaDoElemento(r.el, nomeDaTag(campo), r.node, r.faixa) } : null;
                };
                regrasItem.forEach(regraP => {
                    // A linha do erro é a de onde está o valor que disparou a regra:
                    // dentro do item, ou no cabeçalho da guia quando o campo mora lá
                    // (ex.: codigoPrestadorNaOperadora do executante). Só na falta
                    // dela cai na linha do item.
                    const campo0 = regraP.condicoes[0].campo;
                    const loc = localizar(campo0);
                    const faixa0 = loc ? faixaDoElemento(loc.el, nomeDaTag(campo0), loc.node, loc.faixa) : null;
                    aplicarRegra(regraP, lerItem, alvoItem, faixa0 ?? item.faixa,
                        { item: item.seq, codigo: item.cod, descricao: item.desc });
                });
            });
        }

        // Contadores por guia derivados de results.erros/alertas (que já
        // carregam o campo `guia`) — sem contador paralelo pra dessincronizar.
        const errosGuia = results.erros.filter(e => e.guia === identificadorGuia).length;
        const alertasGuia = results.alertas.filter(a => a.guia === identificadorGuia).length;

        results.guias.push({
            guiaPrestador: identificadorGuia,
            senha: senha || 'S/N',
            carteirinha,
            linha: numLinhaGuia,
            valorTotal: declarados.totalGeral,
            valorCalculado: somaCalculadaGuia,
            erros: errosGuia,
            alertas: alertasGuia,
            detalhesValores: {
                proc: { dec: declarados.proc, calc: despesasCalc.proc },
                dia: { dec: declarados.dia, calc: despesasCalc.dia },
                tax: { dec: declarados.tax, calc: despesasCalc.tax },
                mat: { dec: declarados.mat, calc: despesasCalc.mat },
                med: { dec: declarados.med, calc: despesasCalc.med },
                opme: { dec: declarados.opme, calc: despesasCalc.opme },
                gas: { dec: declarados.gas, calc: despesasCalc.gases }
            }
        });
    });

    // O total do lote só é "declarado" se existir uma tag própria no XML
    // (valorTotalLote). Sem ela, o resumo usa a soma calculada das guias.
    const valorTotalLoteTag = getTagVal(xmlDoc, 'valorTotalLote');
    const valorTotalLoteInformado = valorTotalLoteTag !== '';
    const valorTotalLoteDeclarado = valorTotalLoteInformado ? parseFloat(valorTotalLoteTag) : null;

    // Total do lote: só é conferido se o XML traz a tag valorTotalLote; compara
    // com a soma dos totais das guias.
    if (valorTotalLoteInformado && centavos(valorTotalLoteDeclarado) !== centavos(somaTotalLoteCalculado)) {
        results.erros.push({
            linha: findLineNumber(linesArray, 'valorTotalLote'),
            guia: "LOTE",
            item: "-",
            codigo: "-",
            descricao: "Resumo do Lote",
            tipo: "Erro",
            categoria: "fin",
            mensagem: `Divergência no valor total do lote: Declarado ${formatMoneyBR(valorTotalLoteDeclarado)} vs Calculado (soma das guias) ${formatMoneyBR(somaTotalLoteCalculado)}.`,
            targetTag: "valorTotalLote"
        });
        results.categorias.fin++;
    }

    results.resumoLote = {
        versao: getTagVal(xmlDoc, 'Padrao'),
        lote: getTagVal(xmlDoc, 'numeroLote'),
        prestador: prestadorLote,
        operadora: getTagVal(xmlDoc, 'registroANS') || getTagVal(xmlDoc, 'codigoOperadora') || 'N/I',
        valorTotalLoteDeclarado: valorTotalLoteInformado ? valorTotalLoteDeclarado : somaTotalLoteCalculado,
        valorTotalLoteCalculado: somaTotalLoteCalculado,
        valorTotalLoteInformado
    };

    return results;
}
