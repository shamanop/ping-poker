# PROGRESS music_sync (branch music-sync)
- [x] music-clock.js shared math + tests/music-clock.test.js (in npm test)
- [x] music.js server hook (stations, static mp3 w/ ranges+cache, music:state/ping, /api/music/state)
- [x] public/music.js + music.css bar, station picker, volume/mute persistence, autoplay gate, ducking, drift correction
- [x] placeholder tracks (3 stations x 3) + stations.json; real music_source stations.json not yet present at build time (real mp3s were landing in the-ping-merge/public/audio/music: basement-funk, high-roller, late-night, smoky-lounge)
- [x] qa/music/two_context.py all pass; screenshots in qa/music/
- Open: real-network sync (localhost RTT ~1 ms), real mp3 VBR seek accuracy, iOS (ignores element.volume), no live-listener count.
