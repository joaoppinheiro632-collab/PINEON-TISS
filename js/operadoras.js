// Mapeia o código registroANS de uma operadora (ex: "333051") para um
// nome amigável que o próprio usuário define (ex: "Unimed Guarulhos").
// O XML TISS não traz o nome da operadora, só o código — e decorar códigos
// não é prático quando se trabalha com várias operadoras diferentes.
// Guardado só neste navegador (localStorage), sem chamada de rede.
const STORAGE_KEY = 'pinware_operadoras_nomes';

export function getNomeOperadora(codigo) {
    if (!codigo) return null;
    return getMapa()[codigo] || null;
}

export function setNomeOperadora(codigo, nome) {
    if (!codigo) return;
    const mapa = getMapa();
    if (nome && nome.trim()) {
        mapa[codigo] = nome.trim();
    } else {
        delete mapa[codigo];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mapa));
}

function getMapa() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch {
        return {};
    }
}
