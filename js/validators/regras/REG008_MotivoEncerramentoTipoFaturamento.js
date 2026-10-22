import { getTagVal, findLineNumber } from '../../utils/xml.js';

// Mapa de Motivo de Encerramento -> Tipos de Faturamento PROIBIDOS para esse motivo.
// Códigos de Tipo de Faturamento: 1-Parcial, 2-Final, 3-Complementar, 4-Total
const TIPOS_PROIBIDOS = {
    // Altas (11 a 19): não podem ser Parcial
    11: [1],
    12: [1],
    14: [1],
    15: [1],
    16: [1],
    18: [1],
    19: [1],

    // Permanência (21 a 28): não podem ser Final nem Total
    21: [2, 4],
    22: [2, 4],
    23: [2, 4],
    24: [2, 4],
    25: [2, 4],
    26: [2, 4],
    27: [2, 4],
    28: [2, 4],

    // Transferência (31 e 32): não podem ser Parcial nem Complementar
    31: [1, 3],
    32: [1, 3],

    // Óbito (41, 42 e 43): não podem ser Parcial nem Complementar
    41: [1, 3],
    42: [1, 3],
    43: [1, 3],

    // Encerramento Administrativo (51): não pode ser Final nem Total
    51: [2, 4],

    // 61 a 67: não podem ser Parcial nem Complementar
    61: [1, 3],
    62: [1, 3],
    63: [1, 3],
    64: [1, 3],
    65: [1, 3],
    66: [1, 3],
    67: [1, 3]
};

const DESCRICOES_TIPO = {
    1: "Parcial",
    2: "Final",
    3: "Complementar",
    4: "Total"
};

export default {
    id: "REG008",
    descricao: "Validar Tipo de Faturamento x Motivo de Encerramento",
    execute(guiaNode, context) {
        const motivoStr = getTagVal(guiaNode, 'motivoEncerramento');
        const tipoStr = getTagVal(guiaNode, 'tipoFaturamento');

        if (!motivoStr || !tipoStr) return;

        const motivo = Number(motivoStr);
        const tipo = Number(tipoStr);

        const proibidos = TIPOS_PROIBIDOS[motivo];

        if (proibidos && proibidos.includes(tipo)) {
            const linha = findLineNumber(context.linesArray, 'tipoFaturamento', context.numLinhaGuia);
            const descTipo = DESCRICOES_TIPO[tipo] || tipo;

            context.results.erros.push({
                linha,
                guia: context.identificadorGuia,
                item: "-",
                codigo: "-",
                descricao: "Cabeçalho Guia",
                tipo: "Erro",
                categoria: "estrut",
                mensagem: `Erro TISS 1713 - Tipo de faturamento informado (${tipo} - ${descTipo}) não condiz com o motivo de encerramento (${motivo}).`,
                targetTag: "tipoFaturamento"
            });
            context.results.categorias.estrut++;
        }
    }
};
