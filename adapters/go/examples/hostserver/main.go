// A Go host answering rsc-kit host calls.
//
// This is the whole backend half of the adapter: register functions, serve the
// callback endpoint, proxy everything else to the renderer. It doubles as the
// fixture for the end-to-end test, which is deliberate — an example that is
// not executed is an example that drifts.
//
//	go run ./examples/hostserver -secret s3cret -addr 127.0.0.1:8099
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	rsckit "github.com/rsc-kit/rsc-kit/adapters/go"
)

func main() {
	var (
		addr     = flag.String("addr", "127.0.0.1:0", "address for the callback endpoint")
		secret   = flag.String("secret", "", "shared secret, matching httpHostCalls")
		renderer = flag.String("renderer", "", "url of the JS renderer; pages are proxied to it when set")
		path     = flag.String("path", "/__rsc/host-call", "where the renderer POSTs host calls")
	)

	flag.Parse()

	if *secret == "" {
		log.Fatal("-secret is required")
	}

	registry := rsckit.NewRegistry()

	// The smallest thing a page can ask for: one value, one argument.
	registry.Register("getUser", func(_ context.Context, args rsckit.Args) (any, error) {
		name := "world"

		if args.Len() > 0 {
			if err := args.Bind(&name); err != nil {
				return nil, err
			}
		}

		// The marker is for the end-to-end test: finding it in rendered HTML
		// proves the value came from this process rather than from a default
		// somewhere in the render.
		return map[string]any{"display": name + " via go"}, nil
	})

	// An ordinary read. Args arrive positionally, exactly as the component
	// passed them to rpc().
	registry.Register("Orders.recent", func(_ context.Context, args rsckit.Args) (any, error) {
		limit := 10
		if args.Len() > 0 {
			if err := args.Bind(&limit); err != nil {
				return nil, err
			}
		}

		orders := make([]map[string]any, 0, limit)
		for i := 1; i <= limit; i++ {
			orders = append(orders, map[string]any{"id": i, "total": i * 100})
		}

		return orders, nil
	})

	// Deliberately slow, for the fixture's streaming page: two boundaries ask
	// for different delays and each paints when its own answer lands.
	//
	// The context is the one the callback request arrived on, so a visitor who
	// navigates away stops this rather than leaving it to finish into nothing.
	registry.Register("slowData", func(ctx context.Context, args rsckit.Args) (any, error) {
		ms := 0
		if args.Len() > 0 {
			if err := args.Bind(&ms); err != nil {
				return nil, err
			}
		}

		select {
		case <-time.After(time.Duration(ms) * time.Millisecond):
			return map[string]any{"value": fmt.Sprintf("%dms of Go", ms)}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})

	// The visitor's session, forwarded from the page request. This is what
	// makes a host call run as them rather than as nobody.
	registry.Register("Me.session", func(ctx context.Context, _ rsckit.Args) (any, error) {
		return rsckit.HeadersFrom(ctx).Get("Cookie"), nil
	})

	// A write that says what it dirtied, so the answer can carry the
	// re-rendered region instead of telling the browser to ask again.
	registry.Register("Orders.create", func(ctx context.Context, args rsckit.Args) (any, error) {
		var name string
		if err := args.Bind(&name); err != nil {
			return nil, err
		}

		rsckit.Revalidate(ctx, "orders")

		return map[string]any{"created": name}, nil
	})

	registry.Register("Orders.fail", func(context.Context, rsckit.Args) (any, error) {
		return nil, errors.New("orders table is missing")
	})

	registry.Register("Orders.panic", func(context.Context, rsckit.Args) (any, error) {
		panic("nil map write")
	})

	callback, err := rsckit.NewCallbackHandler(registry, *secret)
	if err != nil {
		log.Fatal(err)
	}

	var handler http.Handler = callback

	if *renderer != "" {
		r, err := rsckit.NewRenderer(*renderer)
		if err != nil {
			log.Fatal(err)
		}

		handler = rsckit.NewHandler(r, callback, *path)
	} else {
		mux := http.NewServeMux()
		mux.Handle(*path, callback)
		handler = mux
	}

	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatal(err)
	}

	// The port, for a caller that asked for :0. Printed and flushed before
	// serving so a supervising test can wait on this line.
	fmt.Printf("listening on http://%s\n", listener.Addr().String())
	os.Stdout.Sync()

	log.Fatal(http.Serve(listener, handler))
}
