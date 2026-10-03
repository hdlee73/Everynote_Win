"""Writes a tiny multi-page text PDF used by the CI smoke test."""
import sys

def build(path, pages=3):
    objs = []
    objs.append("<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{3 + 2*i} 0 R" for i in range(pages))
    objs.append(f"<< /Type /Pages /Kids [ {kids} ] /Count {pages} >>")
    font_id = 3 + 2 * pages
    for i in range(pages):
        page_id = 3 + 2 * i
        content_id = page_id + 1
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>")
        text = f"BT /F1 28 Tf 72 700 Td (PDF Note sample page {i+1}) Tj 0 -40 Td /F1 14 Tf (The quick brown fox jumps over the lazy dog.) Tj 0 -24 Td (Highlight me, write on me, search for fox.) Tj ET"
        objs.append(f"<< /Length {len(text)} >>\nstream\n{text}\nendstream")
    objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offs = []
    for n, body in enumerate(objs, 1):
        offs.append(len(out))
        out += f"{n} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
    for o in offs:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    open(path, "wb").write(out)

build(sys.argv[1] if len(sys.argv) > 1 else "sample.pdf")
