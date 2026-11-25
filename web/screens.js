function hostSDP(sdp) {
  return sdp.replace(/^a=candidate:.*\r?\n?/gm, line => /\btyp host(?:\s|$)/.test(line) ? line : '');
}

export function createScreens({ rpc, identity, changed, warning }) {
  const peers = new Map();
  const incoming = new Map();
  let local;
  let epoch = 0;

  function publish() {
    changed({ local, incoming: [...incoming].map(([peerId, stream]) => ({ peerId, stream })) });
  }

  function close(key) {
    const peer = peers.get(key);
    if (!peer) return;
    peers.delete(key);
    for (const channel of peer.channels) channel.close();
    peer.pc.close();
    if (!peer.sending) {
      incoming.delete(peer.other);
      publish();
    }
  }

  function connect(key, other, broadcaster, sending) {
    const pc = new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' });
    const peer = { pc, other, broadcaster, sending, key, channels: new Set(), candidates: [], tasks: Promise.resolve() };
    peers.set(key, peer);
    pc.ondatachannel = ({ channel }) => peer.channels.add(channel);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && /\btyp host(?:\s|$)/.test(candidate.candidate)) {
        rpc('rtc:signal', { target: other, broadcaster, candidate: candidate.toJSON() }).catch(() => {});
      }
    };
    pc.ontrack = ({ track, streams }) => {
      if (peers.get(key) !== peer) return;
      const stream = streams[0] ?? incoming.get(other) ?? new MediaStream();
      if (!stream.getTracks().includes(track)) stream.addTrack(track);
      incoming.set(other, stream);
      publish();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        close(key);
        warning('A LAN peer connection failed. Check Wi-Fi client isolation and local network permissions.');
      }
    };
    return peer;
  }

  async function description(peer, localDescription) {
    if (peers.get(peer.key) !== peer) return;
    await peer.pc.setLocalDescription({ type: localDescription.type, sdp: hostSDP(localDescription.sdp) });
    const { type, sdp } = peer.pc.localDescription;
    await rpc('rtc:signal', {
      target: peer.other, broadcaster: peer.broadcaster, description: { type, sdp: hostSDP(sdp) },
    });
  }

  function enqueue(peer, work) {
    peer.tasks = peer.tasks.then(() => {
      if (peers.get(peer.key) === peer) return work();
    }).catch(error => {
      if (peers.get(peer.key) === peer) {
        close(peer.key);
        warning(error.message || 'Screen signaling failed.');
      }
    });
  }

  function sync({ members, broadcasters }) {
    const own = identity();
    if (!own || typeof RTCPeerConnection !== 'function') return;
    for (const [key, peer] of peers) {
      if (!members.includes(peer.other) || (!peer.sending && !broadcasters.includes(peer.other)) || (peer.sending && !local)) close(key);
    }
    if (!local || !broadcasters.includes(own)) return;
    for (const other of members) {
      const key = 'send:' + other;
      if (other === own || peers.has(key)) continue;
      const peer = connect(key, other, own, true);
      for (const track of local.getTracks()) peer.pc.addTrack(track, local);
      enqueue(peer, async () => description(peer, await peer.pc.createOffer()));
    }
  }

  function signal({ sender, broadcaster, description: remote, candidate }) {
    const own = identity();
    if (!own || typeof RTCPeerConnection !== 'function') return;
    const sending = broadcaster === own;
    const key = (sending ? 'send:' : 'receive:') + sender;
    if (sending && !peers.has(key)) return;
    const peer = peers.get(key) ?? connect(key, sender, broadcaster, sending);
    enqueue(peer, async () => {
      if (candidate) {
        if (!/\btyp host(?:\s|$)/.test(candidate.candidate)) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate);
        else peer.candidates.push(candidate);
      } else if (remote) {
        await peer.pc.setRemoteDescription({ type: remote.type, sdp: hostSDP(remote.sdp) });
        for (const item of peer.candidates.splice(0)) await peer.pc.addIceCandidate(item);
        if (remote.type === 'offer') await description(peer, await peer.pc.createAnswer());
      }
    });
  }

  function stopLocal() {
    epoch++;
    if (local) {
      for (const track of local.getTracks()) track.stop();
      local = undefined;
    }
    for (const [key, peer] of peers) if (peer.sending) close(key);
    publish();
  }

  async function stop() {
    stopLocal();
    if (identity()) await rpc('screen:state', { active: false });
  }

  async function start() {
    if (!identity()) throw new Error('Join a room first.');
    if (local) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen capture requires a supported browser on localhost or trusted LAN HTTPS.');
    }
    const attempt = ++epoch;
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    if (epoch !== attempt || !identity()) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    local = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stop().catch(() => {}), { once: true });
    publish();
    try { await rpc('screen:state', { active: true }); }
    catch (error) { stopLocal(); throw error; }
  }

  function reset() {
    stopLocal();
    for (const key of [...peers.keys()]) close(key);
  }

  return { start, stop, sync, signal, reset };
}
