// This disposable test relay exposes the container's loopback-only bridge to
// host Chrome. Docker publishes its port on host loopback only; it is never
// included in the product installer or used instead of the installed bridge.
package main

import (
	"io"
	"log"
	"net"
	"time"
)

func main() {
	listener, err := net.Listen("tcp", ":47418")
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	for {
		connection, err := listener.Accept()
		if err != nil {
			log.Fatal(err)
		}
		go forward(connection)
	}
}

func forward(client net.Conn) {
	defer client.Close()
	bridge, err := net.DialTimeout("tcp", "127.0.0.1:47417", 5*time.Second)
	if err != nil {
		return
	}
	defer bridge.Close()
	done := make(chan struct{})
	go func() {
		_, _ = io.Copy(bridge, client)
		if tcp, ok := bridge.(*net.TCPConn); ok {
			_ = tcp.CloseWrite()
		}
		close(done)
	}()
	_, _ = io.Copy(client, bridge)
	if tcp, ok := client.(*net.TCPConn); ok {
		_ = tcp.CloseWrite()
	}
	<-done
}
