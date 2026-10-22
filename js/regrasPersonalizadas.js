// Regras personalizadas: o usuário define, pela tela de Configurações,
// condições do tipo "se o campo X [condição] Y, gere Erro/Alerta", e
// opcionalmente uma correção automática (reescrever esse campo pra um valor
// certo). Avaliadas por guia, além das regras fixas (REG001-REG008).
//
// Formato de uma regra:
// {
//   id, campo (nome da tag TISS checada, ex: "tipoFaturamento"),
//   condicao: 'igual' | 'diferente' | 'contem' | 'maior' | 'menor' | 'vazio'
//           | 'tamanhoIgual' | 'tamanhoMaior' | 'tamanhoMenor',
//   valor (string de comparação),
//   severidade: 'Erro' | 'Alerta',
//   mensagem (texto livre do usuário),
//   campoCorrigir (nome da tag a corrigir — pode ser igual ou diferente de
//     `campo`; ex: erro é no tipoFaturamento mas a correção é no
//     motivoEncerramento. Vazio/null = sem correção automática pra essa regra),
//   valorCorrigir (valor novo a aplicar em campoCorrigir)
// }
const STORAGE_KEY = 'pinware_regras_personalizadas';

export function getRegras() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
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

export function removerRegra(id) {
    const regras = getRegras().filter(r => r.id !== id);
    salvarRegras(regras);
    return regras;
}

// Avalia uma condição. valorCampo sempre chega como string (vem de
// getTagVal); comparações numéricas convertem ambos os lados antes.
export function avaliarCondicao(valorCampo, condicao, valorComparacao) {
    const v = (valorCampo ?? '').trim();
    const comp = (valorComparacao ?? '').trim();

    switch (condicao) {
        case 'igual': return v === comp;
        case 'diferente': return v !== comp;
        case 'contem': return v.includes(comp);
        case 'vazio': return v === '';
        case 'maior': return parseFloat(v) > parseFloat(comp);
        case 'menor': return parseFloat(v) < parseFloat(comp);
        case 'tamanhoIgual': return v.length === parseInt(comp, 10);
        case 'tamanhoMaior': return v.length > parseInt(comp, 10);
        case 'tamanhoMenor': return v.length < parseInt(comp, 10);
        default: return false;
    }
}

export const LABELS_CONDICAO = {
    igual: 'é igual a',
    diferente: 'é diferente de',
    contem: 'contém',
    vazio: 'está vazio',
    maior: 'é maior que',
    menor: 'é menor que',
    tamanhoIgual: 'tem quantidade de caracteres igual a',
    tamanhoMaior: 'tem mais caracteres que',
    tamanhoMenor: 'tem menos caracteres que'
};
