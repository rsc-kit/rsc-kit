// The Go half of the example: the functions the pages call, the guards
// middleware.ts names, and the endpoint the renderer posts to.
//
// Nothing here serves a page. The renderer does that, on its own port, and
// forwards any url it does not own back here - so a Go route registered on
// this mux is reachable at the renderer's origin too.
package main

import (
	"context"
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
	// Typed: the parameters and the result are written to rsc-host.json, so
	// the page's rpc('Orders.recent', 5) is Order[] and rejects a string.
	reg.Handle("Orders.recent", func(ctx context.Context, limit *int) ([]Order, error) {
		n := 5
		if limit != nil {
			n = *limit
		}

		orders := make([]Order, 0, n)
		for i := 1; i <= n; i++ {
			orders = append(orders, Order{ID: i, Total: i * 1250})
		}

		return orders, nil
	})

	// What the browser calls: a server action, exported as ordersCreate. A
	// form posting to it sends its fields as NewOrder.
	reg.HandleAction("ordersCreate", "Orders.create", func(ctx context.Context, in NewOrder) (Created, error) {
		if strings.TrimSpace(in.Name) == "" {
			return Created{}, rsckit.InvalidField("name", "The name field is required.")
		}

		// The page's orders section is stale now; the answer carries it re-rendered.
		rsckit.Revalidate(ctx, "page")

		return Created{Created: in.Name}, nil
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
		if err := reg.WriteManifest(*manifest); err != nil {
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

// Order is one row of the orders page.
type Order struct {
	ID    int `json:"id"`
	Total int `json:"total"`
}

// NewOrder is what the order form posts.
type NewOrder struct {
	Name string `json:"name"`
}

// Created is the action's answer.
type Created struct {
	Created string `json:"created"`
}
