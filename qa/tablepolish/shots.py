exec(open('/home/isabelle/.openclaw/workspace/the-ping-build/qa/tablepolish/play.py').read().split("    import json")[0])
    import json
    # play; capture: turn state (A's turn), emote from top seat, showdown
    got={}
    t0=time.time()
    pb.keyboard.press('1')
    while time.time()-t0<200 and len(got)<3:
        txt=pa.inner_text('body').lower()
        if 'turn' not in got and pa.query_selector('.seat.hero.active') :
            pa.screenshot(path=OUT+'/c-turn.png'); got['turn']=1
        if 'emote' not in got and 'turn' in got:
            pb.keyboard.press('2'); pa.wait_for_timeout(500); pa.screenshot(path=OUT+'/c-emote.png'); got['emote']=1
        if 'win' not in got and pa.query_selector('.seat.winner') and pa.query_selector('.seat-peek.reveal'):
            pa.wait_for_timeout(700); pa.screenshot(path=OUT+'/c-showdown.png'); got['win']=1
        for pg in (pa,pb):
            try:
                el=pg.query_selector('#btn-check-call')
                if el and el.is_visible() and el.is_enabled(): el.click(timeout=400)
            except Exception: pass
        pa.wait_for_timeout(300)
    print(got)
    r=pa.evaluate("""()=>{const q=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]};return {strip:q('#emote-strip'),btn:q('.emote-btn'),log:q('#chat-messages'),charm:q('.pj-charm')}}""")
    print(r)
finally:
    srv.terminate()
