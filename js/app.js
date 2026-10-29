import { EditorManager } from './editor.js';
import { UIManager, escapeHtml } from './ui.js';
import { parseAndValidateXML } from './parser.js';
import { loadZipFile, loadXmlFile } from './zip.js';
import { exportCSV, exportGuiasCSV, exportChangelogCSV, exportZIP, exportXML } from './exports.js';
import { corrigirLinhas } from './correcao.js';
import { suportaPasta, getNomePasta, escolherPasta, removerPasta } from './pastaSalvar.js';
import { getSguConfig, saveSguConfig, clearSguConfig, openSguUploadScreen, formatRelativeSavedAt } from './sgu.js';
import { registrarTransmissao, getHistorico, removerRegistro } from './history.js';
import { registrarAlteracoes, getChangelog } from './changelog.js';
import { getNomeOperadora, setNomeOperadora } from './operadoras.js';
import { getResumoAutomatico, getNotaDoDia, salvarNotaDoDia } from './relatorio.js';
import { getRegras, adicionarRegra, atualizarRegra, removerRegra, descreverRegra, limparNomeTag, REGEX_NOME_TAG, REGEX_CODIGO_PRESTADOR, parsePrestadores, LABELS_CONDICAO, CONDICOES_ENTRE_CAMPOS } from './regrasPersonalizadas.js';

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
        this.initResumoToggle();
        this.initMobile();
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
        document.getElementById('regras-modal-close').onclick = () => this.fecharRegrasModal();
        document.getElementById('btn-add-regra-personalizada').onclick = () => this.handleAddRegraPersonalizada();
        document.getElementById('btn-add-condicao').onclick = () => this.addCondicaoRow();
        document.getElementById('regras-modal-fechar-2').onclick = () => this.fecharRegrasModal();
        document.getElementById('btn-cancelar-edicao-regra').onclick = () => this.limparFormularioRegra();
        document.getElementById('regra-modo-corrigir').onchange = () => this.atualizarModoCorrecao();
        document.getElementById('btn-usar-prestador-lote').onclick = () => this.usarPrestadorDoLote();
        this.ui.onCorrigirApontamento = (item) => this.handleCorrigirApontamento(item);
        document.getElementById('sgu-modal-close').onclick = () => this.closeSguModal();
        document.getElementById('sgu-modal-overlay').onclick = (e) => {
            if (e.target.id === 'sgu-modal-overlay') this.closeSguModal();
        };
        document.getElementById('sgu-save-btn').onclick = () => this.handleSguSave();
        document.getElementById('btn-corrigir-todas').onclick = () => this.handleCorrigirTodas();
        document.getElementById('btn-pasta-escolher').onclick = () => this.handleEscolherPasta();
        document.getElementById('btn-pasta-remover').onclick = () => this.handleRemoverPasta();
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
        // Imprimir por Ctrl+P também: a observação precisa estar na altura
        // do texto, senão a folha sai cortada.
        window.addEventListener('beforeprint', () => this.ui.ajustarAlturaNota());

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

            // Só o rótulo muda — o botão tem um ícone SVG dentro; textContent no
            // botão inteiro apagaria ele.
            document.getElementById('btn-export-zip-label').textContent = isZip ? 'Baixar Lote (.zip)' : 'Baixar XML (.xml)';

            const encodingLabel = document.getElementById('sb-encoding');
            if (encodingLabel) {
                encodingLabel.textContent = encoding === 'utf-8' ? 'UTF-8' : 'ISO-8859-1';
            }

            this.editor.setText(xmlRawText);
            this.processCurrentXML(true);
            if (this.mobileMq.matches) this.setMobileView('resumo');

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
            await exportXML(this.originalXmlFilename, this.editor.getText());
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
        this.renderPastaSalvar();
        document.getElementById('sgu-modal-overlay').classList.remove('hidden');
        document.getElementById('sgu-url-input').focus();
    }

    // ── Pasta para salvar os arquivos gerados (lote, CSVs) ──
    async renderPastaSalvar(mensagem = '') {
        const info = document.getElementById('pasta-salvar-info');
        const btnEscolher = document.getElementById('btn-pasta-escolher');
        const btnRemover = document.getElementById('btn-pasta-remover');

        if (!suportaPasta()) {
            info.textContent = 'Este navegador não deixa o site escolher pasta (funciona no Chrome e no Edge). Os arquivos continuam indo para Downloads.';
            btnEscolher.disabled = true;
            btnRemover.classList.add('hidden');
            return;
        }

        const nome = await getNomePasta();
        info.textContent = (nome
            ? `Salvando em: ${nome}`
            : 'Nenhuma pasta escolhida: os arquivos vão para Downloads.') + (mensagem ? ` — ${mensagem}` : '');
        btnEscolher.textContent = nome ? 'Trocar pasta' : 'Escolher pasta';
        btnRemover.classList.toggle('hidden', !nome);
    }

    async handleEscolherPasta() {
        try {
            const nome = await escolherPasta();
            await this.renderPastaSalvar(nome ? 'pasta guardada neste navegador.' : '');
        } catch (err) {
            alert(`Não foi possível escolher a pasta: ${err.message}`);
        }
    }

    async handleRemoverPasta() {
        await removerPasta();
        await this.renderPastaSalvar('voltou para Downloads.');
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
        if (!document.querySelector('#regra-condicoes-lista .condicao-row')) this.addCondicaoRow();
        document.getElementById('regras-modal-overlay').classList.remove('hidden');
    }

    fecharRegrasModal() {
        document.getElementById('regras-modal-overlay').classList.add('hidden');
        // Fechar no meio de uma edição descarta a edição (não deixa o
        // formulário preso numa regra antiga na próxima abertura).
        if (this.regraEditandoId) this.limparFormularioRegra();
    }

    // Atalho: acrescenta ao campo "Vale para" o prestador do lote aberto.
    usarPrestadorDoLote() {
        const codigo = this.validationResults?.resumoLote?.prestador;
        if (!codigo) { alert('Abra um lote primeiro para usar o prestador dele.'); return; }
        const campo = document.getElementById('regra-prestadores');
        const atuais = parsePrestadores(campo.value);
        if (!atuais.includes(codigo)) atuais.push(codigo);
        campo.value = atuais.join(', ');
    }

    // Correção automática: valor fixo OU copiar o valor de outro campo da guia.
    atualizarModoCorrecao() {
        const copiar = document.getElementById('regra-modo-corrigir').value === 'copiar';
        document.getElementById('regra-valor-corrigir-label').textContent = copiar
            ? 'Campo de origem (de onde copiar o valor)'
            : 'Passar a valer';
        document.getElementById('regra-valor-corrigir').placeholder = copiar
            ? 'ex: numeroGuiaOperadora'
            : 'ex: 12';
    }

    // Volta o formulário ao estado de "nova regra".
    limparFormularioRegra() {
        this.regraEditandoId = null;
        document.getElementById('regra-condicoes-lista').innerHTML = '';
        document.getElementById('regra-combinador').value = 'E';
        document.getElementById('regra-nivel').value = 'guia';
        this.addCondicaoRow();
        document.getElementById('regra-severidade').value = 'Erro';
        document.getElementById('regra-modo-corrigir').value = 'fixo';
        ['regra-mensagem', 'regra-campo-corrigir', 'regra-valor-corrigir', 'regra-prestadores'].forEach(id => {
            document.getElementById(id).value = '';
        });
        this.atualizarModoCorrecao();
        this.atualizarEstadoEdicaoRegra();
        this.renderRegrasPersonalizadas();
    }

    // Textos/botões que mudam entre "nova regra" e "editando regra".
    atualizarEstadoEdicaoRegra(nome = '') {
        const editando = Boolean(this.regraEditandoId);
        document.getElementById('regra-editando-aviso').classList.toggle('hidden', !editando);
        document.getElementById('regra-editando-nome').textContent = nome;
        document.getElementById('btn-cancelar-edicao-regra').classList.toggle('hidden', !editando);
        document.getElementById('btn-add-regra-personalizada').textContent = editando ? 'Salvar alterações' : 'Salvar regra';
    }

    // Carrega uma regra existente no formulário.
    iniciarEdicaoRegra(r) {
        this.regraEditandoId = r.id;

        document.getElementById('regra-combinador').value = r.combinador === 'OU' ? 'OU' : 'E';
        document.getElementById('regra-nivel').value = ['item', 'ocorrencia'].includes(r.nivel) ? r.nivel : 'guia';
        const lista = document.getElementById('regra-condicoes-lista');
        lista.innerHTML = '';
        (r.condicoes || []).forEach(cond => this.addCondicaoRow(cond));
        if (!lista.children.length) this.addCondicaoRow();
        this.atualizarRotulosCondicoes();

        document.getElementById('regra-severidade').value = r.severidade === 'Alerta' ? 'Alerta' : 'Erro';
        document.getElementById('regra-mensagem').value = r.mensagem || '';
        document.getElementById('regra-campo-corrigir').value = r.campoCorrigir || '';
        document.getElementById('regra-modo-corrigir').value = r.origemCorrigir ? 'copiar' : 'fixo';
        document.getElementById('regra-valor-corrigir').value = r.origemCorrigir || r.valorCorrigir || '';
        document.getElementById('regra-prestadores').value = (r.prestadores || []).join(', ');
        this.atualizarModoCorrecao();
        this.atualizarEstadoEdicaoRegra(r.mensagem || descreverRegra(r));

        this.renderRegrasPersonalizadas();
        document.querySelector('#regras-modal-overlay .regra-form').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    // Uma linha do formulário = uma condição (campo + operador + valor).
    addCondicaoRow(preset = {}) {
        const lista = document.getElementById('regra-condicoes-lista');
        const row = document.createElement('div');
        row.className = 'condicao-row';

        const opcoes = Object.entries(LABELS_CONDICAO)
            .map(([valor, rotulo]) => `<option value="${valor}">${rotulo}</option>`).join('');

        row.innerHTML = `
            <span class="condicao-se">${lista.children.length === 0 ? 'Se' : (document.getElementById('regra-combinador').value === 'OU' ? 'ou' : 'e')}</span>
            <input type="text" class="modal-text-input cond-campo" placeholder="tag (ex: tipoFaturamento)" aria-label="Campo (tag TISS)">
            <select class="modal-text-input cond-operador" aria-label="Condição">${opcoes}</select>
            <input type="text" class="modal-text-input cond-valor" placeholder="valor" aria-label="Valor de comparação">
            <button type="button" class="btn-remove-row cond-remover" title="Remover condição"><svg class="icon icon-sm"><use href="#i-x"/></svg></button>
        `;

        const operador = row.querySelector('.cond-operador');
        const valor = row.querySelector('.cond-valor');
        // "está vazio" não compara com nada
        const ajustarValor = () => {
            valor.disabled = operador.value === 'vazio';
            if (valor.disabled) valor.value = '';
            valor.placeholder = CONDICOES_ENTRE_CAMPOS.has(operador.value) ? 'tag do outro campo' : 'valor';
        };
        operador.onchange = ajustarValor;

        row.querySelector('.cond-remover').onclick = () => {
            if (lista.children.length > 1) { row.remove(); this.atualizarRotulosCondicoes(); }
        };

        if (preset.campo) row.querySelector('.cond-campo').value = preset.campo;
        if (preset.condicao) operador.value = preset.condicao;
        if (preset.valor !== undefined) valor.value = preset.valor;
        ajustarValor();

        lista.appendChild(row);
        document.getElementById('regra-combinador').onchange = () => this.atualizarRotulosCondicoes();
    }

    // "Se" na primeira linha; "e"/"ou" nas demais, conforme o combinador.
    atualizarRotulosCondicoes() {
        const conector = document.getElementById('regra-combinador').value === 'OU' ? 'ou' : 'e';
        document.querySelectorAll('#regra-condicoes-lista .condicao-se').forEach((el, i) => {
            el.textContent = i === 0 ? 'Se' : conector;
        });
    }

    // Lista compacta: só o nome dado ao erro (a mensagem da regra), o tipo e
    // os botões. A regra completa aparece no tooltip e ao clicar em editar.
    renderRegrasPersonalizadas() {
        const regras = getRegras();
        const tbody = document.getElementById('tbody-regras-personalizadas');
        tbody.innerHTML = '';

        if (!regras.length) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">Nenhuma regra cadastrada.</td></tr>`;
            return;
        }

        regras.forEach(r => {
            const nome = r.mensagem || descreverRegra(r);
            let detalhe = `Se ${descreverRegra(r)}`;
            if (r.campoCorrigir) {
                detalhe += r.origemCorrigir
                    ? ` | Corrige ${r.campoCorrigir} copiando ${r.origemCorrigir}`
                    : ` | Corrige ${r.campoCorrigir} para ${r.valorCorrigir}`;
            }

            // Onde a regra vale: nome amigável do prestador quando o usuário já
            // nomeou (clicando no código no Histórico), senão o próprio código.
            const escopo = (r.prestadores || []).length
                ? r.prestadores.map(cod => getNomeOperadora(cod) || cod).join(', ')
                : 'Todos';
            detalhe += ` | Vale para: ${escopo}`;
            if (r.nivel === 'item') detalhe += ' | Roda em cada item da guia';
            if (r.nivel === 'ocorrencia') detalhe += ' | Roda em cada ocorrência do 1º campo';

            const tr = document.createElement('tr');
            if (r.id === this.regraEditandoId) tr.className = 'editando';
            tr.innerHTML = `
                <td class="regra-nome" title="${escapeHtml(detalhe)}">${escapeHtml(nome)}</td>
                <td class="regra-escopo" title="${escapeHtml(escopo)}">${escapeHtml(escopo)}</td>
                <td><span class="badge ${r.severidade === 'Erro' ? 'badge-error' : 'badge-warn'}">${escapeHtml(r.severidade)}</span></td>
                <td class="regra-acoes">
                    <button type="button" class="btn-remove-row btn-edit-row" title="Editar regra"><svg class="icon icon-sm"><use href="#i-pencil"/></svg></button>
                    <button type="button" class="btn-remove-row btn-del-row" title="Remover regra"><svg class="icon icon-sm"><use href="#i-x"/></svg></button>
                </td>
            `;
            tr.querySelector('.btn-edit-row').onclick = () => this.iniciarEdicaoRegra(r);
            tr.querySelector('.btn-del-row').onclick = () => {
                removerRegra(r.id);
                if (r.id === this.regraEditandoId) this.limparFormularioRegra();
                this.renderRegrasPersonalizadas();
                if (this.editor.getText()) this.processCurrentXML(false);
            };
            tbody.appendChild(tr);
        });
    }

    handleAddRegraPersonalizada() {
        const condicoes = [];
        for (const row of document.querySelectorAll('#regra-condicoes-lista .condicao-row')) {
            const campo = limparNomeTag(row.querySelector('.cond-campo').value);
            const condicao = row.querySelector('.cond-operador').value;
            let valor = row.querySelector('.cond-valor').value.trim();

            if (!REGEX_NOME_TAG.test(campo)) {
                alert(`"${campo || '(vazio)'}" não é um nome de tag válido. Use só letras, números, _ ou - (ex: tipoFaturamento).`);
                return;
            }
            if (condicao !== 'vazio' && valor === '') {
                alert(`Informe o valor de comparação da condição sobre "${campo}".`);
                return;
            }
            if (CONDICOES_ENTRE_CAMPOS.has(condicao)) {
                valor = limparNomeTag(valor);
                if (!REGEX_NOME_TAG.test(valor)) {
                    alert(`"${valor}" não é um nome de tag válido para comparar com "${campo}".`);
                    return;
                }
            }
            condicoes.push({ campo, condicao, valor });
        }
        if (!condicoes.length) { alert('Adicione pelo menos uma condição.'); return; }

        const campoCorrigir = limparNomeTag(document.getElementById('regra-campo-corrigir').value);
        const modoCopia = document.getElementById('regra-modo-corrigir').value === 'copiar';
        let valorCorrigir = document.getElementById('regra-valor-corrigir').value.trim();
        let origemCorrigir = null;
        if (campoCorrigir) {
            if (!REGEX_NOME_TAG.test(campoCorrigir)) {
                alert(`"${campoCorrigir}" não é um nome de tag válido para corrigir.`);
                return;
            }
            if (modoCopia) {
                origemCorrigir = limparNomeTag(valorCorrigir);
                if (!REGEX_NOME_TAG.test(origemCorrigir)) {
                    alert(`"${origemCorrigir || '(vazio)'}" não é um nome de tag válido para copiar o valor.`);
                    return;
                }
                if (origemCorrigir === campoCorrigir) {
                    alert('O campo de origem não pode ser o mesmo campo que está sendo corrigido.');
                    return;
                }
                valorCorrigir = null;
            } else if (valorCorrigir === '') {
                alert('Informe o valor que o campo a corrigir deve passar a ter.');
                return;
            }
        }

        const prestadores = parsePrestadores(document.getElementById('regra-prestadores').value);
        const invalido = prestadores.find(p => !REGEX_CODIGO_PRESTADOR.test(p));
        if (invalido) {
            alert(`"${invalido}" não parece um código de prestador. Use só letras, números, ponto, _ ou - e separe por vírgula.`);
            return;
        }

        const regra = {
            combinador: document.getElementById('regra-combinador').value,
            nivel: ['item', 'ocorrencia'].includes(document.getElementById('regra-nivel').value)
                ? document.getElementById('regra-nivel').value
                : 'guia',
            condicoes,
            severidade: document.getElementById('regra-severidade').value,
            mensagem: document.getElementById('regra-mensagem').value.trim(),
            campoCorrigir: campoCorrigir || null,
            valorCorrigir: campoCorrigir ? valorCorrigir : null,
            origemCorrigir: campoCorrigir ? origemCorrigir : null,
            prestadores
        };

        if (this.regraEditandoId) atualizarRegra(this.regraEditandoId, regra);
        else adicionarRegra(regra);

        // limpa o formulário (e sai do modo edição) e redesenha a lista
        this.limparFormularioRegra();

        // Regra nova pode mudar o resultado da validação do lote atual.
        if (this.editor.getText()) this.processCurrentXML(false);
    }

    // Reescreve, DENTRO da guia que gerou o apontamento, o valor do campo
    // indicado pela correção automática. Mesma ideia de uma edição manual no
    // editor: registra no log de alterações e reprocessa o lote.
    handleCorrigirApontamento(item) {
        if (!item.autoFix) return;

        const textoAntigo = this.editor.getText();
        const linhas = textoAntigo.split(/\r\n|\r|\n/);

        // Procura só dentro da faixa de linhas do erro — nunca na guia/item vizinho.
        if (corrigirLinhas(linhas, item.autoFix) === -1) {
            alert(`Não encontrei o campo "${item.autoFix.campo}" (com valor na mesma linha) no trecho do erro para corrigir automaticamente.`);
            return;
        }

        const textoNovo = linhas.join('\n');
        registrarAlteracoes(textoAntigo, textoNovo, this.validationResults?.resumoLote?.lote);
        this.editor.setText(textoNovo);
        this.lastKnownText = textoNovo;
        this.processCurrentXML(false);
        this.refreshChangelog();
    }

    // Aplica de uma vez todas as correções automáticas oferecidas no lote.
    // Cada correção só troca o conteúdo de uma linha (nenhuma linha muda de
    // lugar), então as faixas de todas continuam valendo durante o laço.
    handleCorrigirTodas() {
        const res = this.validationResults;
        const fixes = res ? [...res.erros, ...res.alertas].filter(a => a.autoFix).map(a => a.autoFix) : [];
        if (!fixes.length) return;
        if (!confirm(`Aplicar ${fixes.length} correção(ões) automática(s) neste lote? Todas ficam registradas na aba Alterações.`)) return;

        const textoAntigo = this.editor.getText();
        const linhas = textoAntigo.split(/\r\n|\r|\n/);
        const naoAplicadas = fixes.filter(fx => corrigirLinhas(linhas, fx) === -1).length;

        const textoNovo = linhas.join('\n');
        if (textoNovo !== textoAntigo) {
            registrarAlteracoes(textoAntigo, textoNovo, res.resumoLote?.lote);
            this.editor.setText(textoNovo);
            this.lastKnownText = textoNovo;
            this.processCurrentXML(false);
            this.refreshChangelog();
        }
        if (naoAplicadas) alert(`${naoAplicadas} correção(ões) não puderam ser aplicadas (campo não encontrado no trecho).`);
    }

    // Mostra "Corrigir todas (N)" só quando há correção automática disponível.
    atualizarBotaoCorrigirTodas() {
        const res = this.validationResults;
        const n = res ? [...res.erros, ...res.alertas].filter(a => a.autoFix).length : 0;
        const btn = document.getElementById('btn-corrigir-todas');
        btn.classList.toggle('hidden', n === 0);
        btn.textContent = `Corrigir todas (${n})`;
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
        this.atualizarBotaoCorrigirTodas();
    }

    // Resumo do lote recolhível: libera a barra lateral inteira pra lista de
    // guias. O estado fica salvo (é uma preferência de layout, não um dado).
    initResumoToggle() {
        const section = document.getElementById('resumo-section');
        const toggle = document.getElementById('resumo-toggle');
        const CHAVE = 'pinware_ui_resumo_colapsado';

        const aplicar = (colapsado) => {
            section.classList.toggle('collapsed', colapsado);
            toggle.setAttribute('aria-expanded', String(!colapsado));
        };

        try { aplicar(localStorage.getItem(CHAVE) === '1'); } catch { /* storage bloqueado: segue expandido */ }

        toggle.onclick = () => {
            const colapsar = !section.classList.contains('collapsed');
            aplicar(colapsar);
            try { localStorage.setItem(CHAVE, colapsar ? '1' : '0'); } catch { /* ignora */ }
        };
    }

    // Modo celular: em vez de espremer barra lateral + editor + painel inferior
    // na mesma tela, mostra uma seção por vez (Resumo / XML / Análise),
    // trocadas pela barra de navegação inferior.
    initMobile() {
        this.mobileMq = window.matchMedia('(max-width: 768px)');

        document.querySelectorAll('.mobile-nav-item').forEach(btn => {
            btn.onclick = () => this.setMobileView(btn.dataset.view);
        });

        // Tocar numa inconsistência/guia/resultado de busca leva pra linha no
        // XML — no celular isso precisa abrir a seção do editor primeiro
        // (escondido, o textarea não tem altura e a rolagem sairia errada).
        const goToLineOriginal = this.editor.goToLine.bind(this.editor);
        this.editor.goToLine = (...args) => {
            if (this.mobileMq.matches) this.setMobileView('editor');
            goToLineOriginal(...args);
        };
    }

    setMobileView(view) {
        document.body.dataset.mobileView = view;
        document.querySelectorAll('.mobile-nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
        if (view === 'editor') this.editor.updateLineNumbers();
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