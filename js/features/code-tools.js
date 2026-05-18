/**
 * Code Tools Feature
 * Provides copy, toggle, and color picker functionality for code blocks
 */

const CodeTools = {
  _state: {
    exportConfig: null,
    exportConfigPromise: null,
    jsZipPromise: null
  },

  /**
   * Copy text using the Clipboard API when available, otherwise fall back to a hidden textarea.
   * @param {string} text
   * @returns {Promise<void>}
   */
  copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      textarea.style.left = "-9999px";
      textarea.style.opacity = "0";

      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      let succeeded = false;
      try {
        succeeded = document.execCommand("copy");
      } catch (error) {
        succeeded = false;
      }

      textarea.remove();

      if (succeeded) {
        resolve();
      } else {
        reject(new Error("Clipboard copy failed"));
      }
    });
  },

  /**
   * Toggle visibility of a code block
   * @param {string} id - Code block element ID
   */
  toggleCode(id) {
    const codeBlock = getElement(id);
    if (!codeBlock) return;

    if (codeBlock.classList.contains("open")) {
      codeBlock.style.display = "none";
      codeBlock.classList.remove("open");
    } else {
      codeBlock.style.display = "block";
      codeBlock.classList.add("open");
    }
  },

  /**
   * Copy code to clipboard
   * @param {string} id - Code block element ID
   * @param {HTMLElement} btn - Button element (for feedback)
   */
  copyCode(id, btn) {
    const element = getElement(id);
    if (!element) return;

    // Support both <textarea>/<input> (use .value) and any other element (use .innerText)
    const code = (element.tagName === "TEXTAREA" || element.tagName === "INPUT")
      ? element.value
      : element.innerText;

    this.copyText(code)
      .then(() => {
        showToast("Code copied!");

        if (btn) {
          const originalText = btn.innerText;
          btn.innerText = "Copied ✓";
          btn.classList.add("copied");

          setTimeout(() => {
            btn.innerText = originalText;
            btn.classList.remove("copied");
          }, 1500);
        }
      })
      .catch(() => {
        showToast("Failed to copy ❌");
        if (btn) btn.innerText = "Error";
      });
  },

  /**
   * Copy a color value to clipboard
   * @param {string} color - Color string
   */
  copyColor(color) {
    this.copyText(color)
      .then(() => {
        showToast(color + " copied!");
      })
      .catch(() => {
        showToast("Failed to copy ❌");
      });
  },

  /**
   * Copy RGB value to clipboard
   * @param {string} value - RGB value
   */
  copyRGB(value) {
    this.copyText(`rgb(${value})`)
      .then(() => {
        showToast(`rgb(${value}) copied!`);
      })
      .catch(() => {
        showToast("Failed to copy ❌");
      });
  },

  _normalizePath(value) {
    return String(value || '').split('?')[0].split('#')[0];
  },

  _getCurrentPagePath() {
    return this._normalizePath(window.location.pathname || '');
  },

  _getPageSlug() {
    const path = this._getCurrentPagePath();
    const lastSegment = path.split('/').filter(Boolean).pop() || 'index.html';
    return lastSegment.replace(/\.html?$/i, '').toLowerCase();
  },

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-export-lib="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.exportLib = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  },

  _loadJSZip() {
    if (window.JSZip) {
      return Promise.resolve(window.JSZip);
    }

    if (!this._state.jsZipPromise) {
      this._state.jsZipPromise = this._loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js')
        .then(() => window.JSZip)
        .catch((error) => {
          this._state.jsZipPromise = null;
          throw error;
        });
    }

    return this._state.jsZipPromise;
  },

  _loadExportConfig() {
    if (this._state.exportConfig) {
      return Promise.resolve(this._state.exportConfig);
    }

    if (!this._state.exportConfigPromise) {
      this._state.exportConfigPromise = fetch('data/meta/export-map.json', { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((json) => {
          this._state.exportConfig = json && typeof json === 'object' ? json : {};
          return this._state.exportConfig;
        })
        .catch(() => {
          this._state.exportConfig = {
            defaults: {
              fileNames: {
                html: 'component.html',
                css: 'component.css',
                js: 'component.js',
                readme: 'README.md'
              },
              ignoreStylesheets: ['style.css', 'playground.css', 'command-palette.css', 'css/main.css', 'css/url-state.css'],
              ignoreScripts: ['js/', 'script.js', 'playground.js', 'js/bootstrap.js'],
              readmeTemplate: [
                '# {componentTitle}',
                '',
                'This export was generated from {pagePath}.',
                '',
                'Included files:',
                '- component.html',
                '- component.css{hasJsLine}',
                '',
                'Usage:',
                '1. Open component.html in a browser or app shell.',
                '2. Link component.css in the same folder.',
                '{jsUsageLine}',
                '',
                'Notes:',
                '- This package uses the currently active code block and the page-local stylesheet/script.',
                '- Keep the filenames if you want a drop-in export.'
              ].join('\n')
            },
            components: {}
          };
          return this._state.exportConfig;
        });
    }

    return this._state.exportConfigPromise;
  },

  _isIgnoredAsset(href, ignoreList) {
    const normalized = this._normalizePath(href).toLowerCase();
    return (ignoreList || []).some((item) => normalized === item.toLowerCase() || normalized.endsWith('/' + item.toLowerCase()));
  },

  _collectLocalStylesheets(ignoreList, preferred) {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'));
    const hrefs = links.map((link) => this._normalizePath(link.getAttribute('href'))).filter(Boolean);
    const local = hrefs.filter((href) => !/^https?:\/\//i.test(href) && !href.startsWith('data:') && !this._isIgnoredAsset(href, ignoreList));

    if (preferred && preferred.length > 0) {
      const preferredMatch = preferred
        .map((item) => this._normalizePath(item).toLowerCase())
        .filter(Boolean)
        .map((pattern) => local.find((href) => href.toLowerCase().endsWith(pattern)) || null)
        .find(Boolean);

      if (preferredMatch) {
        return [preferredMatch];
      }
    }

    return local;
  },

  _collectLocalScripts(ignoreList, preferred) {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    const hrefs = scripts.map((script) => this._normalizePath(script.getAttribute('src'))).filter(Boolean);
    const local = hrefs.filter((href) => !/^https?:\/\//i.test(href) && !href.startsWith('data:') && !this._isIgnoredAsset(href, ignoreList));

    if (preferred && preferred.length > 0) {
      const preferredMatch = preferred
        .map((item) => this._normalizePath(item).toLowerCase())
        .filter(Boolean)
        .map((pattern) => local.find((href) => href.toLowerCase().endsWith(pattern)) || null)
        .find(Boolean);

      if (preferredMatch) {
        return [preferredMatch];
      }
    }

    return local;
  },

  _getExportProfile() {
    const slug = this._getPageSlug();
    const title = (document.querySelector('main h1, .section-title, .component-card h3, h1')?.textContent || document.title || slug).trim();

    const config = this._state.exportConfig || {};
    const defaults = config.defaults || {};
    const componentMap = config.components || {};
    const entry = componentMap[slug] || componentMap[this._getCurrentPagePath()] || componentMap[document.body?.dataset?.componentId] || null;

    const ignoreStylesheets = [...(defaults.ignoreStylesheets || [])];
    const ignoreScripts = [...(defaults.ignoreScripts || [])];

    if (entry && Array.isArray(entry.ignoreStylesheets)) ignoreStylesheets.push(...entry.ignoreStylesheets);
    if (entry && Array.isArray(entry.ignoreScripts)) ignoreScripts.push(...entry.ignoreScripts);

    const stylesheetCandidates = entry && Array.isArray(entry.stylesheets) && entry.stylesheets.length > 0
      ? entry.stylesheets
      : this._collectLocalStylesheets(ignoreStylesheets, entry && Array.isArray(entry.preferredStylesheets) ? entry.preferredStylesheets : []);

    const scriptCandidates = entry && Array.isArray(entry.scripts) && entry.scripts.length > 0
      ? entry.scripts
      : this._collectLocalScripts(ignoreScripts, entry && Array.isArray(entry.preferredScripts) ? entry.preferredScripts : []);

    return {
      componentId: slug,
      componentTitle: entry?.title || title,
      pagePath: entry?.path || this._getCurrentPagePath(),
      fileNames: Object.assign({
        html: 'component.html',
        css: 'component.css',
        js: 'component.js',
        readme: 'README.md'
      }, defaults.fileNames || {}, entry?.fileNames || {}),
      stylesheetCandidates,
      scriptCandidates,
      readmeTemplate: entry?.readmeTemplate || defaults.readmeTemplate || '',
      htmlLabel: entry?.htmlLabel || 'component.html'
    };
  },

  _readCodeBlock(id) {
    const element = getElement(id);
    if (!element) return '';

    return (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT')
      ? element.value
      : element.innerText;
  },

  async _fetchAssetText(assetPath) {
    if (!assetPath) return '';

    const resolved = new URL(assetPath, document.baseURI).href;
    const response = await fetch(resolved, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${assetPath}`);
    }
    return response.text();
  },

  _buildReadme(profile, hasJs) {
    const template = String(profile.readmeTemplate || '');
    const lines = template.split('\n');
    const rendered = lines.map((line) => {
      return line
        .replace(/\{componentTitle\}/g, profile.componentTitle)
        .replace(/\{pagePath\}/g, profile.pagePath)
        .replace(/\{hasJsLine\}/g, hasJs ? '\n- component.js' : '')
        .replace(/\{jsUsageLine\}/g, hasJs ? '3. Link component.js if the export includes behavior.' : '3. No JavaScript file was detected for this component.');
    }).join('\n');

    return rendered.replace(/\n\n\n+/g, '\n\n').trim() + '\n';
  },

  _downloadBlob(blob, filename) {
    if (window.navigator && typeof window.navigator.msSaveOrOpenBlob === 'function') {
      window.navigator.msSaveOrOpenBlob(blob, filename);
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },

  _injectExportButtons() {
    document.querySelectorAll('.actions').forEach((actions) => {
      if (actions.dataset.exportButtonInjected === '1') return;

      const copyButton = actions.querySelector('button[onclick*="copyCode"]');
      const toggleButton = actions.querySelector('button[onclick*="toggleCode"]');
      const referenceButton = copyButton || toggleButton;
      const onclick = referenceButton ? (referenceButton.getAttribute('onclick') || '') : '';
      const match = onclick.match(/['"]([^'"]+)['"]/);
      const codeId = match ? match[1] : '';
      if (!codeId) return;

      if (actions.querySelector('button[onclick*="exportCode"]')) {
        actions.dataset.exportButtonInjected = '1';
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'export-btn';
      button.setAttribute('aria-label', 'Export component as zip');
      button.setAttribute('title', 'Download as Zip');
      button.setAttribute('onclick', `exportCode('${codeId}', this)`);
      button.innerHTML = '<i class="fa-solid fa-file-zipper"></i> Export';

      if (copyButton && copyButton.nextSibling) {
        actions.insertBefore(button, copyButton.nextSibling);
      } else {
        actions.appendChild(button);
      }

      actions.dataset.exportButtonInjected = '1';
    });
  },

  async exportCode(id, btn) {
    const button = btn || null;
    const originalText = button ? button.innerHTML : '';

    try {
      if (button) {
        button.disabled = true;
        button.innerHTML = 'Exporting...';
      }

      const [profile, JSZip] = await Promise.all([
        this._loadExportConfig().then(() => this._getExportProfile()),
        this._loadJSZip()
      ]);

      const html = this._readCodeBlock(id).trim();
      const cssPath = profile.stylesheetCandidates[0] || '';
      const jsPath = profile.scriptCandidates[0] || '';
      const [css, js] = await Promise.all([
        cssPath ? this._fetchAssetText(cssPath).catch(() => '') : Promise.resolve(''),
        jsPath ? this._fetchAssetText(jsPath).catch(() => '') : Promise.resolve('')
      ]);

      const zip = new JSZip();
      zip.file(profile.fileNames.html || 'component.html', html || '<!-- No component HTML found -->\n');
      zip.file(profile.fileNames.css || 'component.css', css || '/* No component stylesheet detected */\n');

      if (js && js.trim()) {
        zip.file(profile.fileNames.js || 'component.js', js);
      }

      const readme = this._buildReadme(profile, Boolean(js && js.trim()));
      zip.file(profile.fileNames.readme || 'README.md', readme);

      const blob = await zip.generateAsync({ type: 'blob' });
      const filename = `${profile.componentId || 'component'}-export.zip`;
      this._downloadBlob(blob, filename);
      showToast('Component zip downloaded!');
    } catch (error) {
      console.error('[CodeTools] Export failed', error);
      showToast('Export failed ❌');
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = originalText || '<i class="fa-solid fa-file-zipper"></i> Export';
      }
    }
  },

  /**
   * Initialize code tools feature
   */
  init() {
    // Expose to global for backward compatibility with inline onclick handlers
    window.toggleCode = (id) => this.toggleCode(id);
    window.copyCode = (id, btn) => this.copyCode(id, btn);
    window.copyColor = (color) => this.copyColor(color);
    window.copyRGB = (value) => this.copyRGB(value);
    window.exportCode = (id, btn) => this.exportCode(id, btn);

    this._injectExportButtons();
  }
};

// Export for use in bootstrap
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CodeTools;
}
