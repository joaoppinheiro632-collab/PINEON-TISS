// Regras personalizadas: o usuário define, nas Configurações, regras do tipo
//   "se [condição 1] E/OU [condição 2] ..., gere Erro/Alerta",
// e opcionalmente uma correção automática (reescrever um campo do XML pra um
// valor certo). Avaliadas por guia. O PINEON não tem regras fixas: cada
// unidade cria as suas, e cada regra pode valer só pra alguns prestadores.
//
// Formato de uma regra:
// {
//   id,
//   combinador: 'E' | 'OU'            // todas as condições / qualquer uma
//   condicoes: [{ campo, condicao, valor }, ...]
//     campo    = nome da tag TISS (ex: "tipoFaturamento"), sem prefixo "ans:"
//     condicao = 'igual' | 'diferente' | 'contem' | 'vazio' | 'maior' | 'menor'
//              | 'tamanhoIgual' | 'tamanhoMaior' | 'tamanhoMenor'
//              | 'comecaCom'
//              | 'igualCampo' | 'diferenteCampo'   (valor = nome de OUTRA tag da guia)
//   severidade: 'Erro' | 'Alerta',
//   mensagem,
//   campoCorrigir                     // correção automática (opcional). O campo
//                                     // pode ser diferente dos verificados.
//   valorCorrigir                     // ...passa a valer este valor fixo, OU
//   origemCorrigir                    // ...recebe o valor de OUTRO campo da mesma
//                                     // guia (ex: guia solicitada = guia da operadora).
//                                     // Se origemCorrigir existe, ele manda.
//   nivel                             // 'guia' (padrão): lê os campos uma vez por guia, pela
//                                     // 1ª ocorrência da tag. 'item': roda em CADA item da
//                                     // guia (procedimento, material, medicamento, taxa...),
//                                     // lendo os campos de dentro do próprio item — é o que
//                                     // permite regras como "código começa com 19 E
//                                     // valorUnitario menor que 1".
//   prestadores                       // opcional: códigos de prestador (o mesmo de
//                                     // codigoPrestadorNaOperadora do lote) em que a
//                                     // regra vale. Lista vazia = vale pra todos.
// }
//
// Regras salvas na v3.0 tinham uma condição só (campo/condicao/valor na raiz);
// normalizarRegra() converte pro formato novo sem perder nada.
const STORAGE_KEY = 'pinware_regras_personalizadas';

export const LABELS_CONDICAO = {
    igual: 'é igual a',
    diferente: 'é diferente de',
    contem: 'contém',
    vazio: 'está vazio',
    maior: 'é maior que',
    menor: 'é menor que',
    tamanhoIgual: 'tem nº de caracteres igual a',
    tamanhoMaior: 'tem mais caracteres que',
    tamanhoMenor: 'tem menos caracteres que',
    comecaCom: 'começa com',
    igualCampo: 'é igual ao campo',
    diferenteCampo: 'é diferente do campo'
};

// Condições cujo "valor" é o nome de outra tag da guia, não um texto fixo.
export const CONDICOES_ENTRE_CAMPOS = new Set(['igualCampo', 'diferenteCampo']);

// Nome de tag XML simples. Importante validar: o nome é usado pra montar uma
// expressão regular na hora de corrigir o XML, então não pode aceitar
// qualquer texto digitado.
export const REGEX_NOME_TAG = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function limparNomeTag(texto) {
    // aceita que o usuário cole "ans:motivoEncerramento"
    return String(texto ?? '').trim().replace(/^[^:]*:/, '');
}

function normalizarRegra(r) {
    if (!r || typeof r !== 'object') return null;
    const condicoes = Array.isArray(r.condicoes) && r.condicoes.length
        ? r.condicoes
        : (r.campo ? [{ campo: r.campo, condicao: r.condicao, valor: r.valor }] : []);
    if (!condicoes.length) return null;
    const prestadores = Array.isArray(r.prestadores)
        ? r.prestadores.map(p => String(p).trim()).filter(Boolean)
        : [];
    return {
        ...r,
        combinador: r.combinador === 'OU' ? 'OU' : 'E',
        condicoes,
        prestadores,
        nivel: r.nivel === 'item' ? 'item' : 'guia'
    };
}

export const REGEX_CODIGO_PRESTADOR = /^[A-Za-z0-9._-]+$/;

// "650, 712;  905" -> ['650', '712', '905'] (sem repetidos)
export function parsePrestadores(texto) {
    const lista = String(texto ?? '').split(/[\s,;]+/).map(p => p.trim()).filter(Boolean);
    return [...new Set(lista)];
}

// A regra vale pra este prestador? Sem restrição = vale pra todos. Com
// restrição e lote sem código de prestador, não vale (não dá pra saber).
export function regraValeParaPrestador(regra, prestador) {
    const lista = regra.prestadores;
    if (!Array.isArray(lista) || lista.length === 0) return true;
    return lista.includes(String(prestador ?? '').trim());
}

export function getRegras() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map(normalizarRegra).filter(Boolean) : [];
    } catch {
        return [];
    }
}

export function salvarRegras(regras) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(regras));
}

export function adicionarRegra(regra) {
    const regras = getRegras();
    regras.push({ id: `regra_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ...regra });
    salvarRegras(regras);
    return regras;
}

// Substitui o conteúdo de uma regra existente, mantendo o mesmo id.
export function atualizarRegra(id, regra) {
    const regras = getRegras();
    const i = regras.findIndex(r => r.id === id);
    if (i === -1) return regras;
    regras[i] = { ...regra, id };
    salvarRegras(regras);
    return regras;
}

export function removerRegra(id) {
    const regras = getRegras().filter(r => r.id !== id);
    salvarRegras(regras);
    return regras;
}

// Avalia UMA condição. valorCampo é string, ou null quando a tag nem existe
// na guia. Tag ausente só satisfaz "está vazio" — comparar algo que não
// existe (ex: "diferente de 4", "tem menos de 5 caracteres") não é um
// problema do lote, é só um campo que aquele tipo de guia não tem.
// valorOutroCampo só é usado em 'igualCampo' / 'diferenteCampo' (valor lido da
// tag citada em valorComparacao); se qualquer um dos dois campos não existe
// na guia, a condição não dispara.
export function avaliarCondicao(valorCampo, condicao, valorComparacao, valorOutroCampo) {
    if (CONDICOES_ENTRE_CAMPOS.has(condicao)) {
        if (valorCampo == null || valorOutroCampo == null) return false;
        const iguais = String(valorCampo).trim() === String(valorOutroCampo).trim();
        return condicao === 'igualCampo' ? iguais : !iguais;
    }
    if (valorCampo === null || valorCampo === undefined) return condicao === 'vazio';

    const v = String(valorCampo).trim();
    const comp = String(valorComparacao ?? '').trim();

    switch (condicao) {
        case 'igual': return v === comp;
        case 'diferente': return v !== comp;
        case 'contem': return v.includes(comp);
        case 'comecaCom': return comp !== '' && v.startsWith(comp);
        case 'vazio': return v === '';
        case 'maior': return parseFloat(v) > parseFloat(comp);
        case 'menor': return parseFloat(v) < parseFloat(comp);
        case 'tamanhoIgual': return v.length === parseInt(comp, 10);
        case 'tamanhoMaior': return v.length > parseInt(comp, 10);
        case 'tamanhoMenor': return v.length < parseInt(comp, 10);
        default: return false;
    }
}

// lerCampo(nomeDaTag) -> string | null (null = tag não existe na guia)
export function avaliarRegra(regra, lerCampo) {
    if (!regra.condicoes?.length) return false;
    const resultados = regra.condicoes.map(c => {
        const outro = CONDICOES_ENTRE_CAMPOS.has(c.condicao) ? lerCampo(limparNomeTag(c.valor)) : undefined;
        return avaliarCondicao(lerCampo(c.campo), c.condicao, c.valor, outro);
    });
    return regra.combinador === 'OU' ? resultados.some(Boolean) : resultados.every(Boolean);
}

export function descreverCondicao(c) {
    const base = `${c.campo} ${LABELS_CONDICAO[c.condicao] || c.condicao}`;
    return c.condicao === 'vazio' ? base : `${base} "${c.valor}"`;
}

export function descreverRegra(regra) {
    const sep = regra.combinador === 'OU' ? ' OU ' : ' E ';
    return regra.condicoes.map(descreverCondicao).join(sep);
}
