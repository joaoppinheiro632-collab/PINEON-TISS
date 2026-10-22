import { getTagVal, findLineNumber } from '../../utils/xml.js';

export default {
    id: "REG001",
    descricao: "Validar Senha de Autorização",
    execute(guiaNode, context) {
        if (context.tipoGuia === 'consulta') return; // Consulta não exige senha de autorização
        const senha = getTagVal(guiaNode, 'senha');
        if (!senha || senha === '-' || senha.trim() === '') {
            const linha = findLineNumber(context.linesArray, 'senha', context.numLinhaGuia);
            context.results.erros.push({
                linha,
                guia: context.identificadorGuia,
                item: "-",
                codigo: "-",
                descricao: "Senha Autorização",
                tipo: "Erro",
                categoria: "estrut",
                mensagem: "Senha de autorização ausente ou inválida.",
                targetTag: "senha"
            });
            context.results.categorias.estrut++;
        }
    }
};