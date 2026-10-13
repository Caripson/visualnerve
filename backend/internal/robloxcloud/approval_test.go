package robloxcloud

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeTerminal struct {
	mu             sync.Mutex
	buffer         []byte
	flushes, reads int
	output         string
	onPrompt       func(string) string
}

func (f *fakeTerminal) flush() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.flushes++
	f.buffer = nil
	return nil
}
func (f *fakeTerminal) poll(time.Duration) (bool, error) {
	f.mu.Lock()
	ready := len(f.buffer) > 0
	f.mu.Unlock()
	if !ready {
		time.Sleep(time.Millisecond)
	}
	return ready, nil
}
func (f *fakeTerminal) read(value []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads++
	n := copy(value, f.buffer)
	f.buffer = f.buffer[n:]
	return n, nil
}
func (f *fakeTerminal) write(value []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.output += string(value)
	if f.onPrompt != nil {
		f.buffer = []byte(f.onPrompt(string(value)))
	}
	return len(value), nil
}
func (f *fakeTerminal) close() error { return nil }

func approvalFixture() Approval {
	return Approval{Nonce: "vnrbx1.test.00000000000000000000000000000001", SHA256: strings.Repeat("a", 64), Target: Target{"123", "456"}, BaseVersion: 9, TotalBytes: 22}
}
func fakeApprover(terminal *fakeTerminal) *TerminalApprover {
	return &TerminalApprover{io: terminal, gate: make(chan struct{}, 1)}
}

func TestTerminalApprovalRequiresExactFreshSingleUseInput(t *testing.T) {
	approval := approvalFixture()
	phrase, _ := approval.phrase()
	for _, input := range []string{phrase + "\n", phrase + " \n", "yes\n", phrase + "\n" + phrase + "\n", strings.Repeat("x", 256)} {
		terminal := &fakeTerminal{buffer: []byte(phrase + "\n"), onPrompt: func(string) string { return input }}
		approved := fakeApprover(terminal).Approve(context.Background(), approval)
		if approved != (input == phrase+"\n") || terminal.flushes != 2 {
			t.Fatal("terminal accepted stale, partial or extra approval input", approved, terminal.flushes)
		}
		if !strings.Contains(terminal.output, approval.SHA256) || !strings.Contains(terminal.output, "model revision 9") || strings.Contains(terminal.output, "<roblox") || strings.Contains(terminal.output, "api-key") {
			t.Fatal("prompt omitted safe bound metadata or disclosed private content")
		}
	}
}

func TestTerminalApprovalTimeoutFlushesAndLeavesNoReaderForTheNextPrompt(t *testing.T) {
	approval := approvalFixture()
	phrase, _ := approval.phrase()
	terminal := &fakeTerminal{buffer: []byte(phrase + "\n")}
	approver := fakeApprover(terminal)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	if approver.Approve(ctx, approval) || terminal.reads != 0 || terminal.flushes != 2 {
		t.Fatal("stale input survived reset or timed-out prompt consumed a line")
	}
	terminal.onPrompt = func(string) string { return phrase + "\n" }
	if !approver.Approve(context.Background(), approval) || terminal.reads != 1 {
		t.Fatal("a leaked reader consumed later fresh approval")
	}
}

func TestTerminalApprovalSerializesPromptsAndCancellationFailsClosed(t *testing.T) {
	written := make(chan struct{})
	terminal := &fakeTerminal{onPrompt: func(string) string { close(written); return "" }}
	approver := fakeApprover(terminal)
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan bool, 1)
	go func() { result <- approver.Approve(ctx, approvalFixture()) }()
	<-written
	if approver.Approve(context.Background(), approvalFixture()) {
		t.Fatal("concurrent prompt was approved")
	}
	cancel()
	select {
	case approved := <-result:
		if approved {
			t.Fatal("cancelled terminal prompt authorized a request")
		}
	case <-time.After(time.Second):
		t.Fatal("terminal cancellation left a blocked reader")
	}
}

func TestPublisherTerminalGateRejectsFilesAndPipesWithoutReadingRealStdin(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "not-a-tty")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if approver, err := NewTerminalApprover(file); err == nil || approver != nil {
		t.Fatal("noninteractive file enabled publication")
	}
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer read.Close()
	defer write.Close()
	if approver, err := NewTerminalApprover(read); err == nil || approver != nil {
		t.Fatal("MCP/stdin pipe enabled publication")
	}
}
