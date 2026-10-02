// The Go half of the example: the functions the pages call, the guards
// middleware.ts names, and the endpoint the renderer posts to.
//
// Nothing here serves a page. The renderer does that, on its own port, and
// forwards any url it does not own back here - so a Go route registered on
// this mux is reachable at the renderer's origin too.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"strings"

	rsckit "github.com/rsc-kit/go"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "where to listen; RSC_BACKEND in the app's .env")
	manifest := flag.String("manifest", "", "write rsc-host.json here and exit; vite.config.ts runs this as dev and a build start")
	flag.Parse()

	secret := os.Getenv("RSC_HOST_CALL_SECRET")
	if secret == "" {
		secret = "change-me-before-anyone-can-reach-this" // matches ../.env
	}

	reg := rsckit.NewRegistry()

	// What a server component reads: rpc('Orders.recent', 5).
	reg.Register("Orders.recent", func(_ context.Context, args rsckit.Args) (any, error) {
		limit := 5
		if args.Len() > 0 {
			if err := args.Bind(&limit); err != nil {
				return nil, err
			}
		}

		orders := make([]map[string]any, 0, limit)
		for i := 1; i <= limit; i++ {
			orders = append(orders, map[string]any{"id": i, "total": i * 1250})
		}

		return orders, nil
	})

	// What the browser calls: a server action, exported as ordersCreate.
	reg.RegisterAction("ordersCreate", "Orders.create", func(ctx context.Context, args rsckit.Args) (any, error) {
		var name string
		if err := args.Bind(&name); err != nil {
			return nil, err
		}

		if strings.TrimSpace(name) == "" {
			return nil, rsckit.InvalidField("name", "The name field is required.")
		}

		// The page's orders section is stale now; the answer carries it re-rendered.
		rsckit.Revalidate(ctx, "page")

		return map[string]any{"created": name}, nil
	})

	// The guards app/admin/middleware.ts names.
	reg.Middleware("auth", func(ctx context.Context, _ string) error {
		if strings.Contains(rsckit.HeadersFrom(ctx).Get("Cookie"), "session=valid") {
			return nil
		}

		return rsckit.Redirect("/login")
	})
	reg.Middleware("can", func(_ context.Context, ability string) error {
		if ability == "manage-orders" {
			return nil
		}

		return rsckit.Unauthorized("you may not " + ability)
	})

	if *manifest != "" {
		if err := writeManifest(reg, *manifest); err != nil {
			log.Fatal(err)
		}

		return
	}

	callback, err := rsckit.NewCallbackHandler(reg, secret)
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("POST /__rsc/host-call", callback)

	// A url the renderer does not own and forwards here. Reachable at the
	// renderer's origin as well as this one.
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<p>Go serves this page. <a href="/admin">Back to admin</a> with a cookie <code>session=valid</code>.</p>`))
	})

	log.Printf("go backend on http://%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

// writeManifest writes rsc-host.json: the actions the build writes stubs for,
// and every function, which types rpc()'s name. The adapter's own
// reg.WriteManifest writes the same file, from its next release.
func writeManifest(reg *rsckit.Registry, path string) error {
	data, err := json.MarshalIndent(map[string]any{
		"actions":   reg.ActionManifest(),
		"functions": reg.Names(),
	}, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, append(data, '\n'), 0o644)
}
