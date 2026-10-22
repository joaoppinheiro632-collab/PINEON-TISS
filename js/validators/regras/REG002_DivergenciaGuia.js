import { getTagVal } from '../../utils/xml.js';

export default {
    id: "REG002",
    descricao: "Validar Divergência de Números de Guia",
    execute(guiaNode, context) {
        const guiaInternacao = getTagVal(guiaNode, 'numeroGuiaSolicitacaoInternacao');
        const guiaOperadora = getTagVal(guiaNode, 'numeroGuiaOperadora');

        if (guiaInternacao && guiaOperadora && guiaInternacao !== guiaOperadora) {
            context.results.erros.push({
                linha: context.numLinhaGuia,
                guia: context.identificadorGuia,
                item: "-",
                codigo: "-",
                descricao: "Cabeçalho Guia",
                tipo: "Erro",
                categoria: "estrut",
                mensagem: `Divergência entre Guia Solicitada (${guiaInternacao}) e Operadora (${guiaOperadora}).`,
                targetTag: "numeroGuiaOperadora"
            });
            context.results.categorias.estrut++;
        }
    }
};