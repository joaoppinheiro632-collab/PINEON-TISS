const STORAGE_KEY_URL = 'pinware_sgu_upload_url';
const STORAGE_KEY_SAVED_AT = 'pinware_sgu_saved_at';
const STORAGE_KEY_AUTO_OPEN = 'pinware_sgu_auto_open';

// O link de transmissão contém um dynaHash de sessão ativa do SGU — é
// basicamente um token de autenticação em texto puro. Ficamos só com URLs
// http(s) e nunca logamos/exportamos esse valor em nenhum outro lugar do app.
export function isValidSguUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

export function saveSguConfig({ url, autoOpen }) {
    if (!isValidSguUrl(url)) {
        throw new Error('URL inválida. Cole o link completo, começando com http:// ou https://');
    }
    localStorage.setItem(STORAGE_KEY_URL, url.trim());
    localStorage.setItem(STORAGE_KEY_SAVED_AT, String(Date.now()));
    localStorage.setItem(STORAGE_KEY_AUTO_OPEN, autoOpen ? '1' : '0');
}

export function getSguConfig() {
    const url = localStorage.getItem(STORAGE_KEY_URL) || '';
    const savedAtRaw = localStorage.getItem(STORAGE_KEY_SAVED_AT);
    const savedAt = savedAtRaw ? parseInt(savedAtRaw, 10) : null;
    const autoOpen = localStorage.getItem(STORAGE_KEY_AUTO_OPEN) === '1';
    return { url, savedAt, autoOpen };
}

export function clearSguConfig() {
    localStorage.removeItem(STORAGE_KEY_URL);
    localStorage.removeItem(STORAGE_KEY_SAVED_AT);
    localStorage.removeItem(STORAGE_KEY_AUTO_OPEN);
}

// Texto amigável tipo "salvo há 3 dias" — ajuda o usuário a desconfiar de um
// link provavelmente expirado antes mesmo de clicar, em vez de só descobrir
// pelo erro do próprio SGU depois que a aba abre.
export function formatRelativeSavedAt(savedAt) {
    if (!savedAt) return null;
    const diffMs = Date.now() - savedAt;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'salvo agora mesmo';
    if (diffMin < 60) return `salvo há ${diffMin} minuto${diffMin === 1 ? '' : 's'}`;
    const diffHoras = Math.floor(diffMin / 60);
    if (diffHoras < 24) return `salvo há ${diffHoras} hora${diffHoras === 1 ? '' : 's'}`;
    const diffDias = Math.floor(diffHoras / 24);
    return `salvo há ${diffDias} dia${diffDias === 1 ? '' : 's'}`;
}

// Abre a tela de importação do SGU em nova aba. Não envia nada sozinho — o
// usuário ainda precisa selecionar o arquivo dentro do SGU. Retorna false se
// não houver link configurado, pra quem chamar decidir como avisar o usuário.
export function openSguUploadScreen() {
    const { url } = getSguConfig();
    if (!isValidSguUrl(url)) return false;
    window.open(url, '_blank', 'noopener');
    return true;
}
