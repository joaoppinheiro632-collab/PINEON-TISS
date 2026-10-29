import { getElementsByLocalName } from './utils/xml.js';
import { executeRuleEngine } from './validators/ruleEngine.js';

export function parseAndValidateXML(rawText) {
    const linesArray = rawText.split(/\r\n|\r|\n/);
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(rawText, "text/xml");

    const parserErrors = getElementsByLocalName(xmlDoc, 'parsererror');
    if (parserErrors.length > 0) {
        return {
            linesArray,
            xmlDoc: null,
            validationResults: {
                erros: [{
                    linha: 1,
                    guia: "N/A",
                    item: "-",
                    codigo: "-",
                    descricao: "Parser XML",
                    tipo: "Erro",
                    categoria: "estrut",
                    mensagem: "Estrutura XML Inválida (ParserError de sintaxe).",
                    targetTag: "xml"
                }],
                alertas: [],
                guias: [],
                resumoLote: {},
                categorias: { fin: 0, datas: 0, estrut: 1 }
            }
        };
    }

    const validationResults = executeRuleEngine(xmlDoc, linesArray);
    return { linesArray, xmlDoc, validationResults };
}