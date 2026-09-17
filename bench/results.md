| server | page | req/s | TTFB p50 ms | TTFB p99 ms | html kB gz | js kB gz (files) | RSS idle MB | RSS peak MB | CPU ms / 1k req |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next 16 (next start, Node) | `/static` | 4,288 | 7.9 | 14.1 | 3.1 | 170.8 (6) | 293 | 449 | 444 |
| Next 16 (next start, Node) | `/dynamic` | 762 | 9.6 | 18.4 | 3.6 | 170.8 (6) | 293 | 527 | 2027 |
| Next 16 (next start, Node) | `/dynamic-ppr` | 876 | 10.4 | 29.8 | 3.7 | 170.8 (6) | 293 | 594 | 1774 |
| TanStack Start (Nitro, Node) | `/static` | 5,120 | 8.5 | 19.8 | 1.7 | 108.4 (3) | 105 | 333 | 255 |
| TanStack Start (Nitro, Node) | `/dynamic` | 5,072 | 8.7 | 20.5 | 1.7 | 108.5 (3) | 105 | 335 | 238 |
| TanStack Start (Nitro, Node) | `/dynamic-ppr` | 5,016 | 8.8 | 20.9 | 1.7 | 108.5 (3) | 105 | 335 | 238 |
| rsc-kit (Nitro, Node) | `/static` | 16,127 | 2.9 | 6.1 | 0.7 | 0.0 (0) | 76 | 125 | 63 |
| rsc-kit (Nitro, Node) | `/dynamic` | 2,976 | 15.8 | 33.6 | 1.5 | 81.0 (4) | 76 | 273 | 373 |
| rsc-kit (Nitro, Node) | `/dynamic-ppr` | 4,010 | 11.5 | 28.4 | 1.5 | 81.0 (4) | 76 | 284 | 257 |
| rsc-kit (Nitro, Bun) | `/static` | 39,089 | 1.2 | 2.6 | 0.7 | 0.0 (0) | 80 | 85 | 26 |
| rsc-kit (Nitro, Bun) | `/dynamic` | 4,549 | 10.6 | 21.8 | 1.5 | 81.0 (4) | 80 | 122 | 280 |
| rsc-kit (Nitro, Bun) | `/dynamic-ppr` | 5,700 | 8.4 | 17.2 | 1.5 | 81.0 (4) | 80 | 122 | 221 |
| rsc-kit, prerender off (Node) | `/static` | 2,871 | 16.2 | 34.0 | 0.9 | 81.0 (4) | 89 | 285 | 409 |
| rsc-kit, prerender off (Node) | `/dynamic` | 2,867 | 16.2 | 33.9 | 0.9 | 81.0 (4) | 89 | 285 | 391 |
| rsc-kit, prerender off (Node) | `/dynamic-ppr` | 2,839 | 16.4 | 34.5 | 0.9 | 81.0 (4) | 89 | 290 | 390 |
