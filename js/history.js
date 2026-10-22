const STORAGE_KEY_HISTORICO = 'pinware_transmissoes_historico';
const STORAGE_KEY_DIA = 'pinware_transmissoes_dia';
const MAX_REGISTROS = 500; // limite de segurança dentro do próprio dia

function getDiaAtual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Poda diária: o histórico de transmissões vale só para o dia corrente —
// por decisão explícita (não é um arquivo de auditoria de longo prazo, é
// um controle do que já foi enviado hoje). Assim que a data local muda em
// relação à última conhecida, apaga tudo e recomeça do zero.
function checarResetDiario() {
    const diaSalvo = localStorage.getItem(STORAGE_KEY_DIA);
    const diaAtual = getDiaAtual();
    if (diaSalvo !== diaAtual) {
        localStorage.removeItem(STORAGE_KEY_HISTORICO);
        localStorage.setItem(STORAGE_KEY_DIA, diaAtual);
    }
}

// Registra que o usuário GEROU/ABRIU uma transmissão para um lote — não é
// confirmação de que a operadora recebeu ou processou o arquivo. O app não
// tem como saber isso: o botão "Importação" só abre uma aba do sistema da
// operadora (CSP bloqueia qualquer chamada de rede própria), e o upload em
// si acontece manualmente lá. Por isso não existe mais status de
// pendente/confirmado — é só um controle de "o que já foi enviado hoje".
export function registrarTransmissao({ lote, guias, guiasComInconsistencia, valor, erros, alertas, origem, operadora, prestador, pacientes }) {
    checarResetDiario();
    const historico = getHistoricoSemChecar();

    const registro = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        dataHora: Date.now(),
        lote: lote || 'SEM_LOTE',
        guias: Number(guias) || 0,
        guiasComInconsistencia: Number(guiasComInconsistencia) || 0,
        valor: Number(valor) || 0,
        erros: Number(erros) || 0,
        alertas: Number(alertas) || 0,
        origem: origem || 'manual', // 'importacao' | 'download_zip' | 'download_xml' | 'manual'
        operadora: operadora || 'N/I',
        prestador: prestador || 'N/I',
        // Carteirinha por guia, pra dar pra ver quais pacientes foram no lote
        // sem precisar reabrir o XML original.
        pacientes: Array.isArray(pacientes) ? pacientes : []
    };

    historico.unshift(registro);
    if (historico.length > MAX_REGISTROS) {
        historico.length = MAX_REGISTROS;
    }

    salvarHistorico(historico);
    return registro;
}

export function getHistorico() {
    checarResetDiario();
    return getHistoricoSemChecar();
}

function getHistoricoSemChecar() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_HISTORICO);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // localStorage corrompido/adulterado não pode derrubar o app inteiro
        return [];
    }
}

export function removerRegistro(id) {
    const historico = getHistoricoSemChecar().filter(r => r.id !== id);
    salvarHistorico(historico);
}

function salvarHistorico(historico) {
    localStorage.setItem(STORAGE_KEY_HISTORICO, JSON.stringify(historico));
}
