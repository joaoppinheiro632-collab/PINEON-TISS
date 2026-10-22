import REG001 from './regras/REG001_Senhas.js';
import REG002 from './regras/REG002_DivergenciaGuia.js';
import REG003 from './regras/REG003_DatasExecucao.js';
import REG005 from './regras/REG005_CodigoIniciadoPorZero.js';
import REG007 from './regras/REG007_Financeiro.js';
import REG008 from './regras/REG008_MotivoEncerramentoTipoFaturamento.js';

import { getElementsByLocalName, getTagVal, findLineNumber } from '../utils/xml.js';
import { formatMoneyBR } from '../utils/format.js';
import { getRegras, avaliarCondicao, LABELS_CONDICAO } from '../regrasPersonalizadas.js';

const regrasGuia = [REG001, REG002, REG008];
const regrasProcedimento = [REG003, REG005, REG007];

export function executeRuleEngine(xmlDoc, linesArray) {
    const results = {
        erros: [],
        alertas: [],
        guias: [],
        resumoLote: {},
        categorias: { fin: 0, datas: 0, estrut: 0 }
    };

    const regrasPersonalizadas = getRegras();

    const guiasNodes = [
        ...getElementsByLocalName(xmlDoc, 'guiaResumoInternacao'),
        ...getElementsByLocalName(xmlDoc, 'guiaSP-SADT'),
        ...getElementsByLocalName(xmlDoc, 'guiaHonorarioIndividual'),
        ...getElementsByLocalName(xmlDoc, 'guiaConsulta')
    ];

    let somaTotalLoteCalculado = 0;

    // Cursor global usado para localizar a linha de cada guia. As guias são
    // processadas na mesma ordem em que aparecem no documento (DOMParser
    // preserva ordem), então buscar sempre a partir da última linha encontrada
    // (em vez de sempre do início do arquivo) evita casar com o identificador
    // de uma guia posterior que reaproveite o mesmo texto (ex: número de guia
    // referenciado em outro lugar do lote antes da guia real).
    let cursorGlobal = 0;

    guiasNodes.forEach((guiaNode, idx) => {
        const guiaInternacao = getTagVal(guiaNode, 'numeroGuiaSolicitacaoInternacao');
        const guiaOperadora = getTagVal(guiaNode, 'numeroGuiaOperadora');
        const guiaPrestador = getTagVal(guiaNode, 'numeroGuiaPrestador');

        const identificadorGuia = guiaInternacao || guiaOperadora || guiaPrestador || `SEM-NUMERO-${idx+1}`;
        const numLinhaGuia = findLineNumber(linesArray, identificadorGuia, cursorGlobal);
        cursorGlobal = numLinhaGuia;
        const senha = getTagVal(guiaNode, 'senha');
        const carteirinha = getTagVal(guiaNode, 'numeroCarteira') || 'S/N';

        // guiaConsulta é bem mais simples que guiaSP-SADT: um único
        // procedimento solto em <dadosAtendimento>, sem senha de autorização,
        // sem despesas (material/medicamento/OPME/etc) e sem motivo de
        // encerramento/tipo de faturamento. Regras que não fazem sentido
        // nesse tipo de guia checam essa flag pra não gerar falso positivo.
        const tipoGuia = guiaNode.localName === 'guiaConsulta' ? 'consulta' : 'padrao';

        let contextGuia = {
            guiaNode,
            identificadorGuia,
            numLinhaGuia,
            linesArray,
            results,
            tipoGuia
        };

        // Executa regras em nível de Guia
        regrasGuia.forEach(regra => regra.execute(guiaNode, contextGuia));

        // Regras personalizadas (definidas pelo usuário em Configurações).
        // Avaliadas por guia, sobre qualquer tag TISS existente nela.
        regrasPersonalizadas.forEach(regraP => {
            const valorCampo = getTagVal(guiaNode, regraP.campo);
            if (!avaliarCondicao(valorCampo, regraP.condicao, regraP.valor)) return;

            const linha = findLineNumber(linesArray, regraP.campo, numLinhaGuia);
            const lista = regraP.severidade === 'Erro' ? results.erros : results.alertas;

            lista.push({
                linha,
                guia: identificadorGuia,
                item: "-",
                codigo: "-",
                descricao: "Regra Personalizada",
                tipo: regraP.severidade,
                categoria: "estrut",
                mensagem: regraP.mensagem || `Campo "${regraP.campo}" ${LABELS_CONDICAO[regraP.condicao] || regraP.condicao} "${regraP.valor}".`,
                targetTag: regraP.campo,
                // Presente só quando a regra define uma correção automática.
                // A aba Inconsistências usa isso pra mostrar o botão "Corrigir".
                autoFix: regraP.campoCorrigir
                    ? { campo: regraP.campoCorrigir, valorNovo: regraP.valorCorrigir, numLinhaGuia }
                    : null
            });
            results.categorias.estrut++;
        });

        // Cursor local desta guia: avança a cada código encontrado, para que
        // itens com o mesmo código de procedimento repetido dentro da guia
        // casem cada um com a sua própria linha, em vez de todos apontarem
        // para a primeira ocorrência do código.
        let cursorProc = numLinhaGuia;

        // 1. Processa Procedimentos Executados. guiaConsulta não tem uma
        // lista de <procedimentoExecutado> — tem um único procedimento
        // dentro de <dadosAtendimento>, com o valor em <valorProcedimento>
        // (não <valorTotal>) e sem sequencialItem/descrição próprios.
        const procedimentos = tipoGuia === 'consulta'
            ? getElementsByLocalName(guiaNode, 'dadosAtendimento')
            : getElementsByLocalName(guiaNode, 'procedimentoExecutado');
        let somaProcedimentos = 0;

        procedimentos.forEach(proc => {
            const seqItem = getTagVal(proc, 'sequencialItem') || (tipoGuia === 'consulta' ? '1' : '-');
            const codProc = getTagVal(proc, 'codigoProcedimento') || '-';
            const descProc = getTagVal(proc, 'descricaoProcedimento') || (tipoGuia === 'consulta' ? 'Consulta' : 'Procedimento Sem Descrição');
            const valTotal = tipoGuia === 'consulta'
                ? parseFloat(getTagVal(proc, 'valorProcedimento') || 0)
                : parseFloat(getTagVal(proc, 'valorTotal') || 0);
            // Guarda onde terminou o item anterior ANTES de avançar o cursor —
            // é o começo real deste item. No TISS, <dataExecucao> vem ANTES de
            // <codigoProcedimento> dentro do mesmo item; buscar uma tag a
            // partir da linha do código (pra frente) acaba pulando pro próximo
            // item em vez de achar a tag do item atual. REG003 usa esse limite
            // inferior pra buscar a data no lugar certo.
            const limiteInferiorItem = cursorProc;
            const procLinha = findLineNumber(linesArray, codProc, cursorProc);
            cursorProc = procLinha;

            // Contexto passado por referência direta (sem spread) — regras que
            // mutam campos do contexto precisam ver o mesmo objeto, não uma cópia.
            const contextProc = contextGuia;
            contextProc.procNode = proc;
            contextProc.seqItem = seqItem;
            contextProc.codProc = codProc;
            contextProc.descProc = descProc;
            contextProc.procLinha = procLinha;
            contextProc.limiteInferiorLinha = limiteInferiorItem;
            contextProc.isDespesa = false; // Flag identificando procedimento cirúrgico/médico

            regrasProcedimento.forEach(regra => {
                if (regra.executeProcedimento) {
                    regra.executeProcedimento(proc, contextProc);
                }
            });

            somaProcedimentos += valTotal;
        });

        // 2. Processa Despesas / Medicamentos / Materiais / OPME
        const despesasNodes = getElementsByLocalName(guiaNode, 'despesa');
        let despesasCalc = { proc: somaProcedimentos, gases: 0, med: 0, mat: 0, dia: 0, tax: 0, opme: 0 };

        despesasNodes.forEach(desp => {
            const codDesp = getTagVal(desp, 'codigoDespesa');
            const servicos = getElementsByLocalName(desp, 'servicosExecutados');

            servicos.forEach(serv => {
                const seqItem = getTagVal(serv, 'sequencialItem') || '-';
                const codProc = getTagVal(serv, 'codigoProcedimento') || '-';
                const descProc = getTagVal(serv, 'descricaoProcedimento') || 'Despesa Sem Descrição';
                const valDesp = parseFloat(getTagVal(serv, 'valorTotal') || 0);
                const limiteInferiorItem = cursorProc;
                const servLinha = findLineNumber(linesArray, codProc, cursorProc);
                cursorProc = servLinha;

                const contextDesp = contextGuia;
                contextDesp.procNode = serv;
                contextDesp.seqItem = seqItem;
                contextDesp.codProc = codProc;
                contextDesp.descProc = descProc;
                contextDesp.procLinha = servLinha;
                contextDesp.limiteInferiorLinha = limiteInferiorItem;
                contextDesp.isDespesa = true; // Flag indicando que é despesa/material/OPME/medicamento

                // Aplica regras de item sobre as despesas
                regrasProcedimento.forEach(regra => {
                    if (regra.executeProcedimento) {
                        regra.executeProcedimento(serv, contextDesp);
                    }
                });

                // Soma o valor para auditoria por tipo de despesa
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

        // O próximo cursor global de guia nunca pode retroceder para antes do
        // último item processado nesta guia.
        cursorGlobal = Math.max(cursorGlobal, cursorProc);

        // guiaConsulta não tem valorProcedimentos/valorMateriais/.../
        // valorTotalGeral — não existe um "declarado" separado do
        // "calculado" pra comparar (é um único valor, ponto). Declarar igual
        // ao calculado aqui evita que REG007 acuse uma divergência contra um
        // campo que nunca existiu nesse tipo de guia.
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

        const somaCalculadaGuia = REG007.validarSomatoriosGuia(guiaNode, contextGuia, {
            proc: despesasCalc.proc,
            mat: despesasCalc.mat,
            med: despesasCalc.med,
            dia: despesasCalc.dia,
            tax: despesasCalc.tax,
            opme: despesasCalc.opme,
            gas: despesasCalc.gases
        }, declarados);

        somaTotalLoteCalculado += declarados.totalGeral;

        // Contadores por guia derivados diretamente de results.erros/alertas
        // (que já carregam o campo `guia`) em vez de propagados manualmente
        // através dos contextos — impossível dessincronizar, porque não há
        // mais um contador paralelo pra manter em dia.
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

    // O total do lote só é de fato "declarado" se existir uma tag própria no
    // XML pra isso (ex: valorTotalLote no cabeçalho/epílogo do lote). Antes,
    // esse campo recebia a mesma soma calculada — ou seja, o "Valor Total do
    // Lote" nunca era conferido contra nada real, só contra ele mesmo.
    const valorTotalLoteTag = getTagVal(xmlDoc, 'valorTotalLote');
    const valorTotalLoteInformado = valorTotalLoteTag !== '';
    const valorTotalLoteDeclarado = valorTotalLoteInformado ? parseFloat(valorTotalLoteTag) : null;

    if (valorTotalLoteInformado && Math.abs(valorTotalLoteDeclarado - somaTotalLoteCalculado) > 0.01) {
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
        prestador: getTagVal(xmlDoc, 'codigoPrestadorNaOperadora'),
        operadora: getTagVal(xmlDoc, 'registroANS') || getTagVal(xmlDoc, 'codigoOperadora') || 'N/I',
        // Exibido na sidebar: usa o valor declarado no XML quando existe,
        // senão cai para o calculado (e sinaliza isso via valorTotalLoteInformado).
        valorTotalLoteDeclarado: valorTotalLoteInformado ? valorTotalLoteDeclarado : somaTotalLoteCalculado,
        valorTotalLoteCalculado: somaTotalLoteCalculado,
        valorTotalLoteInformado
    };

    return results;
}
