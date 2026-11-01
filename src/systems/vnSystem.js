window.LagHero = window.LagHero || {};

(function (LH) {
  const { VN_SCRIPTS } = LH.ContentData;
  const { saveManager } = LH;
  const { audio } = LH;

  // ============================================================================
  // Visual Novel 赛博终端剧情系统 (`visual-novel` Patterns 1, 2, 3)
  // ============================================================================
  class VNSystem {
    constructor() {
      this.active = false;
      this.currentScript = null;
      this.nodeIndex = 0;
      this.fullText = '';
      this.visibleChars = 0;
      this.charsPerSec = 42;
      this.autoMode = false;
      this.autoTimer = 0;
      this.backlog = [];
      this.onCompleteCallback = null;
      this.onChoiceEffect = null;
      this.blipAccum = 0;
    }

    startScript(scriptId, onComplete, onChoiceEffect) {
      const script = VN_SCRIPTS[scriptId];
      if (!script || !script.nodes || script.nodes.length === 0) {
        if (onComplete) onComplete();
        return;
      }

      this.active = true;
      this.currentScript = script;
      this.nodeIndex = 0;
      this.onCompleteCallback = onComplete || null;
      this.onChoiceEffect = onChoiceEffect || null;

      const overlay = document.getElementById('vn-overlay');
      if (overlay) overlay.classList.remove('hidden');

      this.enterNode(0);
    }

    enterNode(idx) {
      if (!this.currentScript || idx >= this.currentScript.nodes.length) {
        this.closeVN();
        return;
      }

      this.nodeIndex = idx;
      const node = this.currentScript.nodes[idx];
      this.fullText = node.text || '';
      this.visibleChars = 0;
      this.autoTimer = 0;

      const nameEl = document.getElementById('vn-speaker-name');
      const avatarEl = document.getElementById('vn-avatar');
      const choicesEl = document.getElementById('vn-choices');

      if (nameEl) nameEl.textContent = node.speaker || 'TERMINAL';
      if (avatarEl) avatarEl.textContent = node.avatar || 'AI';
      if (choicesEl) {
        choicesEl.innerHTML = '';
        if (node.kind === 'choice' && Array.isArray(node.options)) {
          node.options.forEach((opt) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'vn-choice-btn';
            btn.textContent = opt.label;
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (e.currentTarget && typeof e.currentTarget.blur === 'function') {
                e.currentTarget.blur();
              }
              this.selectOption(opt);
            });
            choicesEl.appendChild(btn);
          });
        }
      }

      this.renderText();
    }

    // `visual-novel` Pattern 2: Lay out text & control visible character count
    renderText() {
      const bodyEl = document.getElementById('vn-body-text');
      if (!bodyEl) return;

      const count = Math.min(this.fullText.length, Math.floor(this.visibleChars));
      const shownPart = this.fullText.slice(0, count);
      const hiddenPart = this.fullText.slice(count);

      // 使用透明占位 span 保持排版宽度恒定，避免打字机换行跳动 (`visual-novel` Pitfall 2)
      bodyEl.innerHTML = '';
      const visibleSpan = document.createElement('span');
      visibleSpan.textContent = shownPart;
      const hiddenSpan = document.createElement('span');
      hiddenSpan.style.opacity = '0';
      hiddenSpan.textContent = hiddenPart;
      bodyEl.appendChild(visibleSpan);
      bodyEl.appendChild(hiddenSpan);
    }

    update(dt) {
      if (!this.active || !this.currentScript) return;
      const node = this.currentScript.nodes[this.nodeIndex];
      if (!node) return;

      if (this.visibleChars < this.fullText.length) {
        this.visibleChars = Math.min(
          this.fullText.length,
          this.visibleChars + this.charsPerSec * dt
        );
        this.blipAccum += dt;
        if (this.blipAccum >= 0.065) {
          this.blipAccum = 0;
          audio.playTypewriterBlip();
        }
        this.renderText();

        if (this.visibleChars >= this.fullText.length) {
          this.recordLineComplete(node);
        }
      } else if (this.autoMode && node.kind === 'line') {
        this.autoTimer += dt;
        const delay = Math.max(1.2, this.fullText.length * 0.04);
        if (this.autoTimer >= delay) {
          this.advance();
        }
      }
    }

    recordLineComplete(node) {
      const lineId = `${this.currentScript.id}_${this.nodeIndex}`;
      if (!saveManager.profile.seenLines.includes(lineId)) {
        saveManager.profile.seenLines.push(lineId);
        saveManager.saveProfile();
      }
      this.backlog.push({
        speaker: node.speaker,
        text: node.text
      });
      if (this.backlog.length > 80) this.backlog.shift();
      this.updateBacklogUI();
    }

    // 第一次点击补全整行，第二次点击进入下一句 (`visual-novel` Pattern 2)
    advance() {
      if (!this.active || !this.currentScript) return;
      const node = this.currentScript.nodes[this.nodeIndex];
      if (!node) return;

      if (this.visibleChars < this.fullText.length) {
        this.visibleChars = this.fullText.length;
        this.renderText();
        this.recordLineComplete(node);
        return;
      }

      // 若是分支选择节点，必须点击选项按钮推进
      if (node.kind === 'choice') return;

      this.enterNode(this.nodeIndex + 1);
    }

    selectOption(opt) {
      if (opt.setFlag) {
        saveManager.profile.storyFlags[opt.setFlag] = true;
        saveManager.saveProfile();
      }
      audio.playPickup(true);
      if (opt.effect && this.onChoiceEffect) {
        this.onChoiceEffect(opt.effect);
      }
      const nextIdx = typeof opt.nextIndex === 'number' ? opt.nextIndex : this.nodeIndex + 1;
      this.enterNode(nextIdx);
    }

    skipAll() {
      if (!this.active || !this.currentScript) return;
      // 若当前脚本包含未选的 choice 节点，直接跳到 choice 节点或默认选第一项
      while (this.nodeIndex < this.currentScript.nodes.length) {
        const node = this.currentScript.nodes[this.nodeIndex];
        this.recordLineComplete(node);
        if (node.kind === 'choice' && node.options && node.options[0]) {
          this.selectOption(node.options[0]);
          break;
        }
        this.nodeIndex++;
      }
      this.closeVN();
    }

    toggleAuto() {
      this.autoMode = !this.autoMode;
      const btn = document.getElementById('vn-btn-auto');
      if (btn) {
        btn.classList.toggle('active', this.autoMode);
        btn.textContent = `AUTO: ${this.autoMode ? 'ON' : 'OFF'}`;
      }
    }

    toggleBacklog() {
      const box = document.getElementById('vn-backlog-box');
      if (!box) return;
      box.classList.toggle('hidden');
      this.updateBacklogUI();
    }

    updateBacklogUI() {
      const box = document.getElementById('vn-backlog-box');
      if (!box) return;
      box.innerHTML = this.backlog
        .slice(-12)
        .map((item) => `<div style="margin-bottom:4px;"><strong style="color:#00f3ff;">[${item.speaker}]</strong>: ${item.text}</div>`)
        .join('');
      box.scrollTop = box.scrollHeight;
    }

    closeVN() {
      this.active = false;
      const overlay = document.getElementById('vn-overlay');
      if (overlay) overlay.classList.add('hidden');
      const cb = this.onCompleteCallback;
      this.onCompleteCallback = null;
      if (cb) cb();
    }
  }

  LH.VNSystem = VNSystem;
  LH.vnSystem = new VNSystem();
})(window.LagHero);
