import http.server, os, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0]
        if p.startswith('/t/'): return os.path.join(ROOT, 'qa', 'overnight', p[3:])
        return os.path.join(ROOT, 'public', p.lstrip('/'))
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
