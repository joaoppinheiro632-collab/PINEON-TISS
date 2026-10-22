import { EditorManager } from './editor.js';
import { UIManager } from './ui.js';
import { parseAndValidateXML } from './parser.js';
import { loadZipFile, loadXmlFile } from './zip.js';
import { exportCSV, exportGuiasCSV, exportChangelogCSV, exportZIP, exportXML } from './exports.js';
import { getSguConfig, saveSguConfig, clearSguConfig, openSguUploadScreen, formatRelativeSavedAt } from './sgu.js';
import { registrarTransmissao, getHistorico, removerRegistro } from './history.js';
import { registrarAlteracoes, getChangelog } from './changelog.js';
import { getNomeOperadora, setNomeOperadora } from './operadoras.js';
import { getResumoAutomatico, getNotaDoDia, salvarNotaDoDia } from './relatorio.js';
import { getRegras, adicionarRegra, removerRegra, LABELS_CONDICAO } from './regrasPersonalizadas.js';
import { findLineNumber } from './utils/xml.js';

class App {
    constructor() {
        this.originalXmlFilename = "LoteTISS.xml";
        this.originalFormat = "zip";
        this.validationResults = null;
        this.debounceTimer = null;
        this.lastKnownText = '';

        this.initDOM();
        this.initManagers();
        this.bindEvents();
        this.refreshTransmissoes();
        this.refreshChangelog();
        this.refreshRelatorio();

        // O histórico de transmissões e o log de alterações zeram sozinhos
        // quando o dia muda (ver history.js/changelog.js). Se a aba ficar
        // aberta atravessando a virada da meia-noite, sem isso o zeramento
        // só apareceria na tela depois de alguma ação do usuário — este
        // intervalo garante que a tela também atualiza sozinha.
        setInterval(() => {
            this.refreshTransmissoes();
            this.refreshChangelog();
            this.refreshRelatorio();
        }, 60000);
    }

    initDOM() {
        this.textarea = document.getElementById('code-textarea');
        this.lineNumDiv = document.getElementById('line-numbers');
        this.zipInput = document.getElementById('zip-input');
        this.sidebar = document.getElementById('sidebar');
        this.bottomPanel = document.getElementById('bottom-panel');
        this.resizer = document.getElementById('panel-resizer');
    }

    initManagers() {
        this.editor = new EditorManager(
            this.textarea,
            this.lineNumDiv,
            document.getElementById('sb-lines'),
            document.getElementById('sb-size'),
            document.getElementById('sb-status')
        );
        this.ui = new UIManager(this.editor);
    }

    bindEvents() {
        // Importação: clique é resolvido pelo <label for="zip-input"> no
        // próprio HTML (sem JS); aqui só tratamos o arrastar-e-soltar,
        // reaproveitando o mesmo processImportedFile() do input de arquivo.
        this.zipInput.onchange = (e) => this.handleFileSelect(e);
        this.bindDropzone();
        document.getElementById('btn-export-csv').onclick = () => exportCSV(this.validationResults);
        document.getElementById('btn-export-guias-csv').onclick = () => exportGuiasCSV(this.validationResults);
        document.getElementById('btn-export-changelog-csv').onclick = () => exportChangelogCSV(getChangelog());
        document.getElementById('btn-export-zip').onclick = () => this.handleExportLote();

        // Integração SGU
        document.getElementById('btn-sgu-transmit').onclick = () => this.handleSguTransmit();
        document.getElementById('btn-sgu-settings').onclick = () => this.openSguModal();

        // Regras Personalizadas
        document.getElementById('btn-regras-settings').onclick = () => this.openRegrasModal();
        document.getElementById('regras-modal-close').onclick = () => document.getElementById('regras-modal-overlay').classList.add('hidden');
        document.getElementById('btn-add-regra-personalizada').onclick = () => this.handleAddRegraPersonalizada();
        this.ui.onCorrigirApontamento = (item) => this.handleCorrigirApontamento(item);
        document.getElementById('sgu-modal-close').onclick = () => this.closeSguModal();
        document.getElementById('sgu-modal-overlay').onclick = (e) => {
            if (e.target.id === 'sgu-modal-overlay') this.closeSguModal();
        };
        document.getElementById('sgu-save-btn').onclick = () => this.handleSguSave();
        document.getElementById('sgu-clear-btn').onclick = () => this.handleSguClear();

        // Histórico de Transmissões — sem botão de limpar: a poda é
        // automática (zera sozinho todo dia, ver history.js). Editar o
        // nome amigável da operadora é feito clicando no próprio valor
        // (delegado dentro de renderTransmissoes).

        // Log de Alterações — mesma lógica: sem botão de limpar, poda
        // diária automática (ver changelog.js).

        // Sub-abas dentro de "Transmissões" (Histórico / Relatório do Dia) —
        // troca independente das abas principais, não usa switchTab().
        document.querySelectorAll('.subtab').forEach(st => {
            st.onclick = (e) => this.switchSubtab(e);
        });
        document.getElementById('btn-imprimir-relatorio').onclick = () => window.print();

        // Sidebar
        document.getElementById('toggle-sidebar-btn').onclick = () => this.toggleSidebar();

        // Filtro Guias
        document.getElementById('chk-only-errors').onchange = (e) => {
            if (this.validationResults) {
                this.ui.renderGuiasTable(this.validationResults, e.target.checked);
            }
        };

        // Editor input debounce
        this.textarea.addEventListener('input', () => {
            this.editor.updateLineNumbers();
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.processCurrentXML(false);
                registrarAlteracoes(this.lastKnownText, this.editor.getText(), this.validationResults?.resumoLote?.lote);
                this.lastKnownText = this.editor.getText();
                this.refreshChangelog();
            }, 500);
        });

        // Busca
        const searchInput = document.getElementById('search-input');
        const searchCount = document.getElementById('search-count');

        searchInput.oninput = () => this.editor.performSearch(searchInput.value, searchCount);
        searchInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.editor.navigateSearch(e.shiftKey ? -1 : 1, searchInput.value, searchCount);
            }
        };

        document.getElementById('btn-search-prev').onclick = () => this.editor.navigateSearch(-1, searchInput.value, searchCount);
        document.getElementById('btn-search-next').onclick = () => this.editor.navigateSearch(1, searchInput.value, searchCount);

        // Go to line
        const gotoInput = document.getElementById('goto-line-input');
        gotoInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                // Sem isso, o Enter continua sendo processado depois que o
                // foco muda pro textarea (dentro de goToLine), e como a
                // linha fica selecionada, o Enter "digita" ali e apaga o
                // conteúdo da linha inteira.
                e.preventDefault();
                this.editor.goToLine(gotoInput.value);
            }
        };

        // Resizer Bottom Panel
        this.initResizer();

        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.onclick = (e) => this.switchTab(e);
        });

        document.getElementById('btn-toggle-panel').onclick = () => this.toggleBottomPanel();
    }

    bindDropzone() {
        const dropzone = document.getElementById('dropzone');

        ['dragenter', 'dragover'].forEach(evt => {
            dropzone.addEventListener(evt, (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });
        });

        ['dragleave', 'dragend'].forEach(evt => {
            dropzone.addEventListener(evt, (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
            });
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) this.processImportedFile(file);
        });
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        await this.processImportedFile(file);
        // Permite selecionar o mesmo arquivo de novo em seguida (senão o
        // navegador não dispara "change" se o valor não mudar).
        event.target.value = '';
    }

    async processImportedFile(file) {
        const isZip = file.name.toLowerCase().endsWith('.zip');
        const isXml = file.name.toLowerCase().endsWith('.xml');

        if (!isZip && !isXml) {
            alert('Selecione um arquivo .xml ou .zip válido contendo o lote TISS.');
            return;
        }

        document.getElementById('file-name').textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;

        try {
            // Independente de vir .xml solto ou .zip contendo o .xml, o
            // resultado da leitura é sempre o mesmo texto de XML — o resto do
            // fluxo (editor, regras, validação) não precisa saber a origem.
            // Só guardamos o formato para exportar de volta no mesmo formato
            // em que o arquivo entrou.
            const { xmlFileName, xmlRawText, encoding } = isZip
                ? await loadZipFile(file)
                : await loadXmlFile(file);

            this.originalXmlFilename = xmlFileName;
            this.originalFormat = isZip ? 'zip' : 'xml';

            const btnExport = document.getElementById('btn-export-zip');
            btnExport.textContent = isZip ? 'Baixar Lote (.zip)' : 'Baixar XML (.xml)';

            const encodingLabel = document.getElementById('sb-encoding');
            if (encodingLabel) {
                encodingLabel.textContent = encoding === 'utf-8' ? 'UTF-8' : 'ISO-8859-1';
            }

            this.editor.setText(xmlRawText);
            this.processCurrentXML(true);

            // O log de Alterações agora é diário (não mais por lote/sessão),
            // então importar um novo arquivo não apaga o que já foi editado
            // hoje em outros lotes — só passa a registrar as próximas edições
            // com o número deste lote nas próximas entradas.
            this.lastKnownText = xmlRawText;
            this.refreshChangelog();
        } catch (err) {
            alert(`Erro ao ler ${isZip ? 'ZIP' : 'XML'}: ` + err.message);
        }
    }

    async handleExportLote() {
        if (!this.editor.getText()) {
            alert('Nenhum lote carregado para exportação.');
            return;
        }

        // Exporta sempre no mesmo formato em que o arquivo foi importado:
        // entrou .xml, sai .xml; entrou .zip, sai .zip.
        if (this.originalFormat === 'xml') {
            exportXML(this.originalXmlFilename, this.editor.getText());
            this.registrarTransmissaoAtual('download_xml');
        } else {
            await exportZIP(
                this.originalXmlFilename,
                this.editor.getText(),
                this.validationResults?.resumoLote?.lote
            );
            this.registrarTransmissaoAtual('download_zip');
        }

        // Abre a tela de importação do SGU automaticamente, se configurado.
        // Não substitui o download acima — é um passo a mais que economiza o
        // usuário ter que procurar a tela no SGU manualmente depois.
        const { autoOpen } = getSguConfig();
        if (autoOpen) {
            const opened = openSguUploadScreen();
            if (!opened) {
                alert('Não foi possível abrir a tela de transmissão SGU: nenhum link configurado. Configure em Integração SGU (ícone de ajustes no topo).');
            }
        }
    }

    handleSguTransmit() {
        const opened = openSguUploadScreen();
        if (!opened) {
            alert('Não foi possível abrir a tela de transmissão.\n\nAtualize o link SGU nas configurações (ícone de ajustes no topo).');
            this.openSguModal();
            return;
        }
        this.registrarTransmissaoAtual('importacao');
    }

    // Grava no histórico local os dados do lote atualmente carregado. Isso
    // NÃO confirma que a operadora recebeu o arquivo — só que o usuário
    // baixou o .zip/.xml ou abriu a tela de importação a partir deste lote.
    // Sem lote carregado (resumoLote vazio), não há o que registrar.
    registrarTransmissaoAtual(origem) {
        const r = this.validationResults?.resumoLote;
        if (!r || !r.lote) return;

        registrarTransmissao({
            lote: r.lote,
            guias: this.validationResults.guias.length,
            // "Erros prevenidos": conta guias com pelo menos uma
            // inconsistência (erro OU alerta) apontada pelo Validador antes
            // do envio — mesmo critério da aba "Inconsistências", que já
            // junta os dois. Não é sobre ter editado o texto do XML. Se o
            // mesmo lote for baixado de novo depois de corrigido,
            // getResumoAutomatico() guarda o PICO desse número por lote (ver
            // relatorio.js), pra não perder o crédito do que foi pego só
            // porque depois foi corrigido.
            guiasComInconsistencia: this.validationResults.guias.filter(g => g.erros > 0 || g.alertas > 0).length,
            valor: r.valorTotalLoteDeclarado,
            erros: this.validationResults.erros.length,
            alertas: this.validationResults.alertas.length,
            origem,
            operadora: r.operadora,
            prestador: r.prestador,
            pacientes: this.validationResults.guias.map(g => ({
                guia: g.guiaPrestador,
                carteirinha: g.carteirinha
            }))
        });
        this.refreshTransmissoes();
        this.refreshRelatorio();
    }

    refreshTransmissoes() {
        this.ui.renderTransmissoes(getHistorico(), {
            onRemove: (id) => this.handleRemoverTransmissao(id),
            onRenamePrestador: (codigo, nomeAtual) => this.handleRenomearPrestador(codigo, nomeAtual)
        });
    }

    handleRemoverTransmissao(id) {
        removerRegistro(id);
        this.refreshTransmissoes();
    }

    handleRenomearPrestador(codigo, nomeAtual) {
        const nome = prompt(`Nome amigável para o prestador ${codigo} (ex: nome da operadora):`, nomeAtual || '');
        if (nome === null) return; // cancelou
        setNomeOperadora(codigo, nome);
        this.refreshTransmissoes();
    }

    refreshChangelog() {
        this.ui.renderChangelog(getChangelog(), (linha, campo) => this.editor.goToLine(linha, campo));
    }

    refreshRelatorio() {
        const resumo = getResumoAutomatico(getHistorico());
        this.ui.renderRelatorio(resumo, getNotaDoDia(), {
            onChangeNota: (texto) => salvarNotaDoDia(texto)
        });
    }

    openSguModal() {
        const { url, savedAt, autoOpen } = getSguConfig();
        document.getElementById('sgu-url-input').value = url;
        document.getElementById('sgu-auto-open-chk').checked = autoOpen;
        this.renderSguSavedInfo(savedAt, url);
        document.getElementById('sgu-modal-overlay').classList.remove('hidden');
        document.getElementById('sgu-url-input').focus();
    }

    closeSguModal() {
        document.getElementById('sgu-modal-overlay').classList.add('hidden');
    }

    handleSguSave() {
        const url = document.getElementById('sgu-url-input').value.trim();
        const autoOpen = document.getElementById('sgu-auto-open-chk').checked;

        try {
            saveSguConfig({ url, autoOpen });
            const { savedAt } = getSguConfig();
            this.renderSguSavedInfo(savedAt, url, 'Link salvo com sucesso.');
        } catch (err) {
            const infoEl = document.getElementById('sgu-saved-info');
            infoEl.textContent = err.message;
            infoEl.className = 'modal-saved-info error';
        }
    }

    handleSguClear() {
        clearSguConfig();
        document.getElementById('sgu-url-input').value = '';
        document.getElementById('sgu-auto-open-chk').checked = false;
        this.renderSguSavedInfo(null, '', 'Link removido.');
    }

    renderSguSavedInfo(savedAt, url, extraMessage = '') {
        const infoEl = document.getElementById('sgu-saved-info');
        const relative = formatRelativeSavedAt(savedAt);

        let text;
        if (extraMessage) {
            text = url && relative ? `${extraMessage} (${relative})` : extraMessage;
        } else if (url && relative) {
            text = `Link atual: ${relative}.`;
        } else {
            text = 'Nenhum link configurado ainda.';
        }

        infoEl.textContent = text;
        infoEl.className = /sucesso|removido/.test(extraMessage) ? 'modal-saved-info ok' : 'modal-saved-info';
    }

    openRegrasModal() {
        this.renderRegrasPersonalizadas();
        document.getElementById('regras-modal-overlay').classList.remove('hidden');
    }

    renderRegrasPersonalizadas() {
        const regras = getRegras();
        const tbody = document.getElementById('tbody-regras-personalizadas');
        tbody.innerHTML = '';

        if (!regras.length) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">Nenhuma regra cadastrada.</td></tr>`;
            return;
        }

        regras.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${r.campo}</td>
                <td>${LABELS_CONDICAO[r.condicao] || r.condicao}</td>
                <td>${r.valor ?? ''}</td>
                <td>${r.severidade}</td>
                <td title="${r.mensagem || ''}">${r.mensagem || '-'}</td>
                <td>${r.campoCorrigir ? `${r.campoCorrigir} → ${r.valorCorrigir}` : '-'}</td>
                <td><button class="btn-remove-row" title="Remover regra"><svg class="icon icon-sm"><use href="#i-x"/></svg></button></td>
            `;
            tr.querySelector('.btn-remove-row').onclick = () => {
                removerRegra(r.id);
                this.renderRegrasPersonalizadas();
            };
            tbody.appendChild(tr);
        });
    }

    handleAddRegraPersonalizada() {
        const campo = document.getElementById('regra-campo').value.trim();
        const condicao = document.getElementById('regra-condicao').value;
        const valor = document.getElementById('regra-valor').value.trim();
        const severidade = document.getElementById('regra-severidade').value;
        const mensagem = document.getElementById('regra-mensagem').value.trim();
        const campoCorrigir = document.getElementById('regra-campo-corrigir').value.trim();
        const valorCorrigir = document.getElementById('regra-valor-corrigir').value.trim();

        if (!campo) {
            alert('Informe o campo (tag TISS) a verificar.');
            return;
        }
        if (condicao !== 'vazio' && !valor) {
            alert('Informe o valor de comparação.');
            return;
        }

        adicionarRegra({
            campo, condicao, valor, severidade, mensagem,
            campoCorrigir: campoCorrigir || null,
            valorCorrigir: campoCorrigir ? valorCorrigir : null
        });

        ['regra-campo', 'regra-valor', 'regra-mensagem', 'regra-campo-corrigir', 'regra-valor-corrigir'].forEach(id => {
            document.getElementById(id).value = '';
        });

        this.renderRegrasPersonalizadas();

        // Regra nova pode mudar o resultado da validação do lote atual.
        if (this.editor.getText()) this.processCurrentXML(false);
    }

    // Reescreve, na própria guia que gerou o apontamento, o valor do campo
    // indicado pela correção automática da regra personalizada. Mesma ideia
    // de uma edição manual no editor: registra no log de alterações e
    // reprocessa o lote.
    handleCorrigirApontamento(item) {
        if (!item.autoFix) return;
        const { campo, valorNovo, numLinhaGuia } = item.autoFix;

        const textoAntigo = this.editor.getText();
        const linhas = textoAntigo.split(/\r\n|\r|\n/);

        const linhaAlvo = findLineNumber(linhas, campo, Math.max(0, numLinhaGuia - 1));
        const idx = linhaAlvo - 1;

        if (idx < 0 || idx >= linhas.length || !linhas[idx].includes(campo)) {
            alert(`Não encontrei o campo "${campo}" nessa guia para corrigir automaticamente.`);
            return;
        }

        // Tag pode ou não ter prefixo de namespace (<ans:campo> ou <campo>).
        const regexTag = new RegExp(`(<(?:[A-Za-z0-9_]+:)?${campo}>)([^<]*)(</(?:[A-Za-z0-9_]+:)?${campo}>)`);
        if (!regexTag.test(linhas[idx])) {
            alert(`Não consegui reconhecer o valor do campo "${campo}" nessa linha para corrigir automaticamente.`);
            return;
        }

        linhas[idx] = linhas[idx].replace(regexTag, `$1${valorNovo}$3`);
        const textoNovo = linhas.join('\n');

        registrarAlteracoes(textoAntigo, textoNovo, this.validationResults?.resumoLote?.lote);
        this.editor.setText(textoNovo);
        this.lastKnownText = textoNovo;
        this.processCurrentXML(false);
        this.refreshChangelog();
    }

    processCurrentXML(refreshStatus = true) {
        const rawText = this.editor.getText();
        const { validationResults } = parseAndValidateXML(rawText);
        this.validationResults = validationResults;

        if (refreshStatus) {
            this.editor.updateStatusbar(rawText, validationResults.erros.length > 0 ? "Possui Erros" : "XML Válido");
        }

        this.ui.renderSummary(validationResults);
        this.ui.renderGuiasTable(validationResults, document.getElementById('chk-only-errors').checked);
        this.ui.renderErrosTable(validationResults);
        this.ui.renderAuditoriaTable(validationResults);
    }

    toggleSidebar() {
        this.sidebar.classList.toggle('collapsed');
        document.getElementById('toggle-sidebar-btn').textContent = this.sidebar.classList.contains('collapsed') ? '>' : '<';
    }

    switchTab(event) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        const targetTabId = event.currentTarget.getAttribute('data-tab');
        event.currentTarget.classList.add('active');
        document.getElementById(targetTabId).classList.add('active');
    }

    switchSubtab(event) {
        const grupo = event.currentTarget.closest('.subtabs').dataset.subtabGroup;
        document.querySelectorAll(`.subtab[data-subtab-group="${grupo}"]`).forEach(t => t.classList.remove('active'));
        document.querySelectorAll(`.subtab-content[data-subtab-group="${grupo}"]`).forEach(c => c.classList.remove('active'));

        const targetId = event.currentTarget.getAttribute('data-subtab');
        event.currentTarget.classList.add('active');
        document.getElementById(targetId).classList.add('active');
    }

    toggleBottomPanel() {
        const btn = document.getElementById('btn-toggle-panel');
        if (this.bottomPanel.classList.contains('minimized')) {
            this.bottomPanel.classList.remove('minimized');
            this.bottomPanel.style.height = '240px';
            btn.textContent = '▼';
        } else {
            this.bottomPanel.classList.add('minimized');
            btn.textContent = '▲';
        }
    }

    initResizer() {
        let isResizing = false;

        this.resizer.addEventListener('mousedown', () => {
            isResizing = true;
            this.resizer.classList.add('resizing');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newHeight = window.innerHeight - e.clientY;
            if (newHeight >= 35 && newHeight <= window.innerHeight * 0.8) {
                this.bottomPanel.style.height = `${newHeight}px`;
                this.bottomPanel.classList.remove('minimized');
                document.getElementById('btn-toggle-panel').textContent = '▼';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                this.resizer.classList.remove('resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }
}

// Inicializa a aplicação ao carregar a página.
// Deliberadamente não exposta em window: reduz a superfície de ataque de
// qualquer XSS futuro (nada de acesso direto a window.app.validationResults,
// editor, etc. a partir de um script injetado).
window.addEventListener('DOMContentLoaded', () => {
    new App();
});