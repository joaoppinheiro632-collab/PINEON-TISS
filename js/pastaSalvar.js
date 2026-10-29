// Onde os arquivos gerados pelo PINEON (lote .zip/.xml, CSVs) são salvos.
//
// Por padrão o navegador joga tudo em Downloads. Em Chrome/Edge dá pra
// escolher uma pasta fixa (File System Access API): o PINEON grava os
// arquivos direto nela, sem passar por Downloads. A pasta escolhida fica
// guardada no próprio navegador (IndexedDB) — nada sai da máquina — e o
// navegador pode pedir de novo a permissão de escrita ao abrir o sistema.
//
// Sem suporte (Firefox/Safari), sem pasta escolhida ou se a permissão for
// negada, cai no download normal: nunca deixa de entregar o arquivo.

const DB_NOME = 'pineon_pasta_salvar';
const STORE = 'config';
const CHAVE = 'pasta';

export function suportaPasta() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function abrirDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NOME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function lerHandle() {
    try {
        const db = await abrirDB();
        return await new Promise((resolve, reject) => {
            const req = db.transaction(STORE).objectStore(STORE).get(CHAVE);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

async function gravarHandle(handle) {
    const db = await abrirDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        if (handle) tx.objectStore(STORE).put(handle, CHAVE);
        else tx.objectStore(STORE).delete(CHAVE);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

// Nome da pasta escolhida (ou null).
export async function getNomePasta() {
    if (!suportaPasta()) return null;
    const handle = await lerHandle();
    return handle ? handle.name : null;
}

// Abre o seletor de pasta do sistema. Retorna o nome, ou null se cancelou.
export async function escolherPasta() {
    if (!suportaPasta()) throw new Error('Este navegador não permite escolher pasta. Use Chrome ou Edge.');
    try {
        const handle = await window.showDirectoryPicker({ id: 'pineon-salvar', mode: 'readwrite' });
        await gravarHandle(handle);
        return handle.name;
    } catch (err) {
        if (err && err.name === 'AbortError') return null; // usuário fechou o seletor
        throw err;
    }
}

export async function removerPasta() {
    await gravarHandle(null);
}

// Se "relatorio.zip" já existe, vira "relatorio (1).zip", "relatorio (2).zip"...
// Nunca sobrescreve um arquivo que já está na pasta.
async function nomeLivre(dirHandle, nome) {
    const ponto = nome.lastIndexOf('.');
    const base = ponto > 0 ? nome.slice(0, ponto) : nome;
    const ext = ponto > 0 ? nome.slice(ponto) : '';
    let candidato = nome;
    for (let n = 1; n < 1000; n++) {
        try {
            await dirHandle.getFileHandle(candidato); // existe -> tenta outro
            candidato = `${base} (${n})${ext}`;
        } catch (err) {
            if (err && err.name === 'NotFoundError') return candidato;
            throw err;
        }
    }
    return `${base} (${Date.now()})${ext}`;
}

function baixarNormal(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

let toastTimer = null;
function aviso(texto) {
    let el = document.getElementById('pineon-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'pineon-toast';
        el.className = 'pineon-toast';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.textContent = texto;
    el.classList.add('visivel');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visivel'), 4500);
}

// Entrega o arquivo: na pasta escolhida, ou em Downloads (padrão do navegador).
export async function entregarArquivo(blob, nome) {
    const handle = suportaPasta() ? await lerHandle() : null;
    if (!handle) {
        baixarNormal(blob, nome);
        return { destino: 'downloads', nome };
    }

    try {
        // Ao reabrir o sistema o navegador esquece a permissão; pedir aqui
        // funciona porque estamos dentro do clique do usuário.
        let perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') throw new Error('permissão negada');

        const nomeFinal = await nomeLivre(handle, nome);
        const arquivo = await handle.getFileHandle(nomeFinal, { create: true });
        const w = await arquivo.createWritable();
        await w.write(blob);
        await w.close();
        aviso(`Salvo em "${handle.name}": ${nomeFinal}`);
        return { destino: 'pasta', nome: nomeFinal, pasta: handle.name };
    } catch (err) {
        console.warn('Não consegui salvar na pasta escolhida; usando Downloads.', err);
        baixarNormal(blob, nome);
        aviso(`Não consegui salvar em "${handle.name}"; o arquivo foi para Downloads.`);
        return { destino: 'downloads', nome };
    }
}
