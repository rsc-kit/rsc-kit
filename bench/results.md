| server | page | req/s | TTFB p50 ms | TTFB p99 ms | full p50 ms | html kB gz | js kB gz (files) | 200s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next 16 (next start, Node) | `/static` | 4,437 | 7.9 | 14.1 | 10.6 | 3.2 | 170.5 (6) | 100% |
| Next 16 (next start, Node) | `/dynamic` | 975 | 23.4 | 46.4 | 50.3 | 3.1 | 170.5 (6) | 100% |
| TanStack Start (Nitro, Node) | `/static` | 5,277 | 8.2 | 19.1 | 8.3 | 1.7 | 108.3 (3) | 100% |
| TanStack Start (Nitro, Node) | `/dynamic` | 5,205 | 8.5 | 19.8 | 8.5 | 1.7 | 108.3 (3) | 100% |
| rsc-kit (Nitro, Node) | `/static` | 11,692 | 4.1 | 6.7 | 4.1 | 0.7 | 0.0 (0) | 100% |
| rsc-kit (Nitro, Node) | `/dynamic` | 2,715 | 18.0 | 23.8 | 18.0 | 1.5 | 81.0 (4) | 100% |
| rsc-kit (Nitro, Bun) | `/static` | 32,978 | 1.2 | 3.7 | 1.2 | 0.7 | 0.0 (0) | 100% |
| rsc-kit (Nitro, Bun) | `/dynamic` | 4,371 | 11.3 | 20.7 | 11.3 | 1.5 | 81.0 (4) | 100% |
| rsc-kit, prerender off (Node) | `/static` | 2,893 | 16.1 | 34.1 | 16.1 | 0.9 | 81.0 (4) | 100% |
| rsc-kit, prerender off (Node) | `/dynamic` | 2,869 | 16.1 | 34.5 | 16.2 | 0.9 | 81.0 (4) | 100% |
