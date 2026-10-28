export class EditorManager {
    constructor(textareaEl, lineNumEl, statusbarLinesEl, statusbarSizeEl, statusbarStatusEl) {
        this.textarea = textareaEl;
        this.lineNumDiv = lineNumEl;
        this.sbLines = statusbarLinesEl;
        this.sbSize = statusbarSizeEl;
        this.sbStatus = statusbarStatusEl;

        this.searchResults = [];
        this.currentSearchIndex = -1;
        this._lastLineCount = -1;

        this.initEvents();
    }

    initEvents() {
        this.textarea.addEventListener('scroll', () => {
            this.lineNumDiv.scrollTop = this.textarea.scrollTop;
        });
    }

    setText(text) {
        this.textarea.value = text;
        this.updateLineNumbers();
        this.updateStatusbar(text);
    }

    getText() {
        return this.textarea.value;
    }

    updateLineNumbers() {
        const count = this.textarea.value.split(/\r\n|\r|\n/).length;
        // Em lotes grandes (milhares de linhas), reconstruir a régua inteira a
        // cada tecla digitada trava perceptivelmente. Na maioria das edições
        // (alterar um valor dentro de uma tag) a quantidade de linhas não
        // muda, então dá pra pular o rebuild nesses casos.
        if (count === this._lastLineCount) return;
        this._lastLineCount = count;

        let linesText = '';
        for (let i = 1; i <= count; i++) {
            linesText += i + '\n';
        }
        this.lineNumDiv.textContent = linesText;
    }

    updateStatusbar(text, statusText = "XML Válido") {
        const lines = text.split(/\r\n|\r|\n/).length;
        this.sbLines.textContent = `Linhas: ${lines}`;
        this.sbSize.textContent = `Tamanho: ${(text.length / 1024).toFixed(1)} KB`;
        this.sbStatus.textContent = statusText;
    }

    goToLine(lineNum, highlightText = null) {
        lineNum = parseInt(lineNum);
        if (isNaN(lineNum) || lineNum < 1) return;

        const lines = this.textarea.value.split(/\r\n|\r|\n/);
        if (lineNum > lines.length) lineNum = lines.length;

        let startPos = 0;
        for (let i = 0; i < lineNum - 1; i++) {
            startPos += lines[i].length + 1;
        }

        const currentLineText = lines[lineNum - 1] || "";
        let matchIndex = -1;

        if (highlightText && highlightText !== "-") {
            matchIndex = currentLineText.indexOf(highlightText);
        }

        this.textarea.focus();

        if (matchIndex !== -1) {
            // Veio de uma busca: seleciona o termo encontrado, pra ficar
            // visível onde ele está na linha.
            const selStart = startPos + matchIndex;
            const selEnd = selStart + highlightText.length;
            this.textarea.setSelectionRange(selStart, selEnd);
        } else {
            // Ir para linha "pura" (sem busca): só posiciona o cursor no
            // início da linha, sem selecionar o conteúdo. Selecionar a linha
            // inteira aqui deixava fácil apagar o texto sem querer (bastava
            // apertar qualquer tecla ou o próprio Enter do campo de busca).
            this.textarea.setSelectionRange(startPos, startPos);
        }

        const percent = (lineNum - 1) / lines.length;
        this.textarea.scrollTop = percent * (this.textarea.scrollHeight - this.textarea.clientHeight);
        this.lineNumDiv.scrollTop = this.textarea.scrollTop;
    }

    performSearch(query, countLabelEl) {
        const linesArray = this.textarea.value.split(/\r\n|\r|\n/);
        this.searchResults = [];
        this.currentSearchIndex = -1;

        if (!query) {
            countLabelEl.textContent = '';
            return;
        }

        linesArray.forEach((line, idx) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
                this.searchResults.push(idx + 1);
            }
        });

        if (this.searchResults.length > 0) {
            countLabelEl.textContent = `${this.searchResults.length} ocorrência(s)`;
        } else {
            countLabelEl.textContent = 'Sem resultados';
        }
    }

    // Linha (1-based) onde o cursor está agora no textarea.
    getCurrentLine() {
        const pos = this.textarea.selectionStart;
        const textoAntes = this.textarea.value.slice(0, pos);
        return (textoAntes.match(/\r\n|\r|\n/g) || []).length + 1;
    }

    navigateSearch(direction, query, countLabelEl) {
        if (this.searchResults.length === 0) return;

        if (this.currentSearchIndex === -1) {
            // Primeira navegação desde essa busca (ainda não usou ▲/▼) —
            // ancora a partir de onde o cursor está agora, não do início do
            // arquivo. Buscar pra baixo pega o primeiro resultado
            // estritamente DEPOIS da linha atual; buscar pra cima pega o
            // último resultado NA linha atual ou antes dela. Se não achar
            // nada nessa direção, dá a volta (primeiro/último do arquivo).
            const linhaAtual = this.getCurrentLine();

            if (direction > 0) {
                const idx = this.searchResults.findIndex(l => l > linhaAtual);
                this.currentSearchIndex = idx === -1 ? 0 : idx;
            } else {
                let idx = -1;
                for (let i = this.searchResults.length - 1; i >= 0; i--) {
                    if (this.searchResults[i] <= linhaAtual) { idx = i; break; }
                }
                this.currentSearchIndex = idx === -1 ? this.searchResults.length - 1 : idx;
            }
        } else {
            this.currentSearchIndex += direction;
            if (this.currentSearchIndex >= this.searchResults.length) {
                this.currentSearchIndex = 0;
            } else if (this.currentSearchIndex < 0) {
                this.currentSearchIndex = this.searchResults.length - 1;
            }
        }

        const targetLine = this.searchResults[this.currentSearchIndex];
        countLabelEl.textContent = `${this.currentSearchIndex + 1} de ${this.searchResults.length}`;
        this.goToLine(targetLine, query);
    }
}