/* ============================================================
   GRAVITY FLUX — 1:1 대전 모드 (PeerJS WebRTC P2P)
   공격 규칙:
   - 라인 클리어: [0,0,1,2,4]줄의 쓰레기 전송 (2줄→1, 3줄→2, 4줄→4)
   - 시프트 체인 라운드: 라운드당 클리어 줄 수만큼 전송
   - 체인 2연쇄 이상: ⚡ 중력 공격 (상대 보드 강제 회전)
   ============================================================ */
'use strict';

(() => {
  const game = window.__game;
  const PREFIX = 'gflux-';
  const PALETTE = [null, '#00e5ff', '#ffd54a', '#c56bff', '#5aff8a', '#ff5a6e', '#5a8dff', '#ff9d3a', '#8a8aa0'];
  const COLOR_IDX = new Map(PALETTE.map((c, i) => [c, i]));

  const B = {
    peer: null, conn: null,
    active: false,      // 대전 진행 중
    connected: false,
    counting: false,    // 카운트다운 진행 중
    myReady: false, oppReady: false, // 재대결 준비
    oppScore: 0,
    stateTimer: null,
  };

  /* ── DOM ── */
  const $ = id => document.getElementById(id);
  const ui = {
    battleBtn: $('battle-btn'),
    panel: $('battle-panel'),
    lobby: $('battle-lobby'),
    createBtn: $('create-room-btn'),
    joinCode: $('join-code'),
    joinBtn: $('join-btn'),
    status: $('battle-status'),
    oppBox: $('opp-box'),
    oppCanvas: $('opp-canvas'),
    oppScore: $('opp-score'),
    oppStatus: $('opp-status'),
    startBtn: $('start-btn'),
    countdown: $('countdown'),
  };
  const octx = ui.oppCanvas.getContext('2d');

  const setStatus = (msg, color) => {
    ui.status.textContent = msg;
    ui.status.style.color = color || '';
  };

  /* ── 연결 ── */
  function genCode() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function createRoom() {
    cleanup();
    const code = genCode();
    setStatus('방 생성 중…');
    B.peer = new Peer(PREFIX + code);
    B.peer.on('open', () => {
      setStatus(`방 코드: ${code.toUpperCase()} — 상대를 기다리는 중…`, '#00e5ff');
    });
    B.peer.on('connection', conn => setupConn(conn, true));
    B.peer.on('error', err => setStatus('연결 오류: ' + err.type, '#ff5a6e'));
  }

  function joinRoom() {
    const code = ui.joinCode.value.trim().toLowerCase();
    if (code.length !== 4) { setStatus('코드 4자리를 입력하세요', '#ff5a6e'); return; }
    cleanup();
    setStatus('접속 중…');
    B.peer = new Peer();
    B.peer.on('open', () => {
      const conn = B.peer.connect(PREFIX + code, { reliable: true });
      setupConn(conn, false);
    });
    B.peer.on('error', err => setStatus(err.type === 'peer-unavailable' ? '방을 찾을 수 없습니다' : '연결 오류: ' + err.type, '#ff5a6e'));
  }

  function setupConn(conn, isHost) {
    B.conn = conn;
    conn.on('open', () => {
      B.connected = true;
      setStatus('상대 연결됨! 곧 시작합니다…', '#5aff8a');
      if (isHost) setTimeout(() => { send({ t: 'start' }); beginBattle(); }, 400);
    });
    conn.on('data', onMessage);
    conn.on('close', () => {
      if (B.active) declareWin('상대의 연결이 끊어졌습니다');
      else setStatus('상대 연결 끊김', '#ff5a6e');
      B.connected = false;
    });
  }

  function cleanup() {
    if (B.stateTimer) { clearInterval(B.stateTimer); B.stateTimer = null; }
    if (B.peer) { try { B.peer.destroy(); } catch (e) { /* 무시 */ } }
    B.peer = null; B.conn = null; B.connected = false; B.active = false;
  }

  const send = msg => { if (B.conn && B.conn.open) B.conn.send(msg); };

  /* ── 프로토콜 ── */
  function onMessage(msg) {
    switch (msg.t) {
      case 'start': beginBattle(); break;
      case 'state':
        B.oppScore = msg.score;
        ui.oppScore.textContent = msg.score.toLocaleString();
        drawOppBoard(msg.g);
        break;
      case 'garbage':
        game.enqueueAttack({ type: 'garbage', n: msg.n });
        break;
      case 'shift':
        game.enqueueAttack({ type: 'shift', dir: msg.dir });
        break;
      case 'over': // 상대 사망 → 승리
        declareWin('상대가 먼저 무너졌습니다!');
        break;
      case 'rematch':
        B.oppReady = true;
        tryRematch();
        break;
    }
  }

  /* ── 대전 시작/종료 ── */
  // 5-4-3-2-1 카운트다운 후 실제 시작
  function beginBattle() {
    if (B.counting) return;
    B.counting = true;
    B.active = false;
    game.hideOverlay();
    game.ensureAudio();
    ui.oppBox.style.display = '';
    const cd = ui.countdown;
    const show = (v, isGo) => {
      cd.textContent = v;
      cd.classList.toggle('go', !!isGo);
      cd.classList.remove('pop');
      void cd.offsetWidth; // 애니메이션 재시작
      cd.classList.add('pop');
    };
    cd.style.display = 'flex';
    let n = 5;
    show(n);
    game.beep(440, 0.12, 'square', 0.07);
    const iv = setInterval(() => {
      n--;
      if (n >= 1) {
        show(n);
        game.beep(n === 1 ? 660 : 440, 0.12, 'square', 0.07);
      } else {
        clearInterval(iv);
        show('GO!', true);
        game.beep(880, 0.35, 'square', 0.08, 1320);
        setTimeout(() => {
          cd.style.display = 'none';
          B.counting = false;
          startBattle();
        }, 600);
      }
    }, 1000);
  }

  function startBattle() {
    B.active = true;
    B.myReady = false; B.oppReady = false;
    ui.oppBox.style.display = '';
    ui.oppStatus.textContent = 'PLAYING';
    ui.oppStatus.style.color = '#5aff8a';
    game.hideOverlay();
    game.startGame();
    game.popup('⚔ BATTLE START!', 222, 150, '#ffd54a', 30);
    if (!B.stateTimer) B.stateTimer = setInterval(sendState, 250);
  }

  function sendState() {
    if (!B.active || !B.connected) return;
    const g = game.G.grid.map(row => row.map(c => c ? (COLOR_IDX.get(c.c) ?? 8) : 0).join('')).join('');
    send({ t: 'state', g, score: game.G.score });
  }

  function declareWin(reason) {
    if (!B.active) return;
    B.active = false;
    game.endRun();
    game.showOverlay('🏆 YOU WIN!', `${reason}<br>SCORE <b>${game.G.score.toLocaleString()}</b>`, '재대결');
    ui.oppStatus.textContent = 'DEFEATED';
    ui.oppStatus.style.color = '#ff5a6e';
  }

  function declareLose() {
    if (!B.active) return;
    B.active = false;
    send({ t: 'over' });
    game.showOverlay('💀 YOU LOSE…', `SCORE <b>${game.G.score.toLocaleString()}</b><br>중력 공격으로 복수하세요!`, '재대결');
  }

  function tryRematch() {
    if (B.myReady && B.oppReady && B.connected) beginBattle();
    else if (B.oppReady) setStatus('상대가 재대결을 원합니다!', '#ffd54a');
  }

  /* ── 게임 훅 연결 ── */
  game.Hooks.onClear = (lines, chainDepth) => {
    if (!B.active) return;
    const n = chainDepth > 0 ? lines : [0, 0, 1, 2, 4][Math.min(lines, 4)];
    if (n > 0) send({ t: 'garbage', n });
  };
  game.Hooks.onChainEnd = chainDepth => {
    if (!B.active) return;
    if (chainDepth >= 1) { // 2연쇄 이상 (chainDepth 1 = 2라운드)
      send({ t: 'shift', dir: Math.random() < 0.5 ? 1 : -1 });
      game.popup('⚡ 중력 공격 전송!', 222, 250, '#ffd54a', 20);
    }
  };
  game.Hooks.onGameOver = () => {
    if (B.active) declareLose();
  };

  /* ── 상대 미니보드 렌더링 ── */
  function drawOppBoard(encoded) {
    const s = ui.oppCanvas.width / 12;
    octx.clearRect(0, 0, ui.oppCanvas.width, ui.oppCanvas.height);
    for (let i = 0; i < encoded.length && i < 144; i++) {
      const v = +encoded[i];
      if (!v) continue;
      const x = i % 12, y = Math.floor(i / 12);
      octx.fillStyle = PALETTE[v] || '#8a8aa0';
      octx.fillRect(x * s + 0.5, y * s + 0.5, s - 1, s - 1);
    }
  }

  /* ── UI 이벤트 ── */
  ui.battleBtn.addEventListener('click', () => {
    const open = ui.panel.style.display !== 'none';
    ui.panel.style.display = open ? 'none' : '';
    if (!open) setStatus('방을 만들거나 코드로 참가하세요');
  });
  ui.createBtn.addEventListener('click', createRoom);
  ui.joinBtn.addEventListener('click', joinRoom);
  ui.joinCode.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); joinRoom(); } });
  ui.joinCode.addEventListener('keyup', e => e.stopPropagation());

  // 대전 종료 후 오버레이 버튼 = 재대결 요청 (캡처 단계에서 가로챔)
  ui.startBtn.addEventListener('click', e => {
    if (!B.connected || B.active) return; // 평소엔 기본 동작(솔로 시작)
    if (game.G.phase === 'gameover') {
      e.stopImmediatePropagation();
      B.myReady = true;
      send({ t: 'rematch' });
      game.showOverlay('⏳ 대기 중', '상대의 재대결 수락을 기다립니다…', '…');
      tryRematch();
    }
  }, true);
  // 대전 중 Enter로 솔로 재시작되는 것 방지
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && B.connected && game.G.phase === 'gameover') e.stopImmediatePropagation();
  }, true);

  window.__battle = B; // 디버그/검증용
})();
