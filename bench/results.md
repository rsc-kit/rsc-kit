| server | page | req/s | TTFB p50 ms | TTFB p99 ms | full p50 ms | html kB gz | js kB gz (files) | 200s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next 16 (next start, Node) | `/static` | 4,304 | 8.0 | 15.1 | 10.9 | 3.1 | 170.8 (6) | 100% |
| Next 16 (next start, Node) | `/dynamic` | 773 | 9.5 | 19.1 | 63.0 | 3.6 | 170.8 (6) | 100% |
| Next 16 (next start, Node) | `/dynamic-ppr` | 895 | 12.7 | 31.6 | 54.6 | 3.7 | 170.8 (6) | 100% |
| TanStack Start (Nitro, Node) | `/static` | 5,131 | 8.5 | 20.0 | 8.6 | 1.7 | 108.4 (3) | 100% |
| TanStack Start (Nitro, Node) | `/dynamic` | 5,099 | 8.7 | 20.2 | 8.7 | 1.7 | 108.5 (3) | 100% |
| TanStack Start (Nitro, Node) | `/dynamic-ppr` | 5,092 | 8.7 | 20.4 | 8.7 | 1.7 | 108.5 (3) | 100% |
| rsc-kit (Nitro, Node) | `/static` | 16,323 | 2.9 | 5.9 | 2.9 | 0.7 | 0.0 (0) | 100% |
| rsc-kit (Nitro, Node) | `/dynamic` | 3,017 | 15.6 | 32.8 | 15.6 | 1.5 | 81.0 (4) | 100% |
| rsc-kit (Nitro, Node) | `/dynamic-ppr` | 4,185 | 11.2 | 23.1 | 11.3 | 1.5 | 81.0 (4) | 100% |
| rsc-kit (Nitro, Bun) | `/static` | 39,840 | 1.1 | 2.6 | 1.1 | 0.7 | 0.0 (0) | 100% |
| rsc-kit (Nitro, Bun) | `/dynamic` | 4,586 | 10.5 | 21.5 | 10.5 | 1.5 | 81.0 (4) | 100% |
| rsc-kit (Nitro, Bun) | `/dynamic-ppr` | 5,696 | 8.4 | 17.0 | 8.5 | 1.5 | 81.0 (4) | 100% |
| rsc-kit, prerender off (Node) | `/static` | 2,890 | 16.0 | 33.9 | 16.1 | 0.9 | 81.0 (4) | 100% |
| rsc-kit, prerender off (Node) | `/dynamic` | 2,889 | 16.2 | 33.8 | 16.2 | 0.9 | 81.0 (4) | 100% |
| rsc-kit, prerender off (Node) | `/dynamic-ppr` | 2,839 | 16.4 | 35.4 | 16.4 | 0.9 | 81.0 (4) | 100% |
