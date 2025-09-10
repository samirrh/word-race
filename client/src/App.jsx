import React, { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000'
const WORD_LEN = 5
const MAX_GUESSES = 6

function Cell({ state, letter }) {
  const cls =
    state === 'g'
      ? 'bg-green-600'
      : state === 'y'
      ? 'bg-yellow-600'
      : state === 'b'
      ? 'bg-slate-700'
      : 'bg-slate-800'
  return (
    <div
      className={`w-12 h-12 grid place-items-center rounded-md font-bold uppercase ${cls}`}
    >
      {letter}
    </div>
  )
}

function Row({ guess = '', feedback = [] }) {
  const letters = guess.padEnd(WORD_LEN, ' ').split('')
  const fb = [...feedback]
  while (fb.length < WORD_LEN) fb.push(null)
  return (
    <div className="grid grid-cols-5 gap-2">
      {letters.map((ch, i) => (
        <Cell key={i} letter={ch.trim()} state={fb[i]} />
      ))}
    </div>
  )
}

export default function App() {
  const [roomId, setRoomId] = useState(
    () => new URLSearchParams(window.location.search).get('room') || 'lobby'
  )
  const [socket, setSocket] = useState(null)
  const [isPlayer, setIsPlayer] = useState(false)
  const isPlayerRef = useRef(false)

  const [board, setBoard] = useState(
    Array.from({ length: MAX_GUESSES }, () => ({ guess: '', fb: [] }))
  )
  const [otherBoard, setOtherBoard] = useState(
    Array.from({ length: MAX_GUESSES }, () => ({ guess: '', fb: [] }))
  )

  const [input, setInput] = useState('')
  const [otherTyping, setOtherTyping] = useState(0) // now stores length
  const [status, setStatus] = useState('')
  const [opponentJoined, setOpponentJoined] = useState(false)
  const [spectators, setSpectators] = useState(0)
  const inputRef = useRef(null)

  // Setup Socket.IO
  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ['websocket'] })
    setSocket(s)

    s.on('connect', () => {
      s.emit('room_join', { roomId })
    })

    s.on('room:hello', (payload) => {
      setIsPlayer(!!payload.youArePlayer)
      isPlayerRef.current = !!payload.youArePlayer
    })

    s.on('room:roster', (payload) => {
      setSpectators(payload.numSpectators || 0)
      const amPlayer = isPlayerRef.current
      setOpponentJoined(amPlayer && payload.numPlayers >= 2)
    })

    s.on('room:opponent_joined', () => {
      setOpponentJoined(true)
      setStatus('Opponent joined! 🟢')
      setTimeout(() => setStatus(''), 1500)
    })

    s.on('typing:update', ({ length }) => {
      setOtherTyping(length)
    })

    s.on('guess:result', (payload) => {
      const row = payload.row
      const entry = { guess: payload.guess, fb: payload.feedback }
      if (payload.sid === s.id) {
        setBoard((prev) => prev.map((r, i) => (i === row ? entry : r)))
      } else {
        setOtherBoard((prev) => prev.map((r, i) => (i === row ? entry : r)))
      }
      if (payload.winnerSid) {
        setStatus(payload.winnerSid === s.id ? 'You win! 🎉' : 'They win! 😤')
      }
    })

    s.on('guess:rejected', ({ reason }) => {
      setStatus(reason)
      setTimeout(() => setStatus(''), 1200)
    })

    s.on('room:finished', ({ solution, winnerSid }) => {
      if (!winnerSid) setStatus('Draw. Solution: ' + solution.toUpperCase())
    })

    s.on('room:reset', () => {
      setBoard(
        Array.from({ length: MAX_GUESSES }, () => ({ guess: '', fb: [] }))
      )
      setOtherBoard(
        Array.from({ length: MAX_GUESSES }, () => ({ guess: '', fb: [] }))
      )
      setStatus('')
      setInput('')
      inputRef.current?.focus()
    })

    return () => s.disconnect()
  }, [roomId])

  // Send typing updates (with input length)
  useEffect(() => {
    if (!socket) return
    socket.emit('typing', { length: input.length })
  }, [input, socket])

  function submitGuess(e) {
    e.preventDefault()
    if (!socket || !isPlayer || input.length !== WORD_LEN) return
    socket.emit('guess', { guess: input })
    setInput('')
  }

  function handleReset() {
    socket?.emit('reset_room')
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex flex-wrap items-center justify-between mb-6 gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">Wordle Race</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            title="Room ID"
          />
          <button
            className="px-3 py-2 rounded-md bg-blue-600"
            onClick={() =>
              (window.location.search = `?room=${encodeURIComponent(roomId)}`)
            }
          >
            Share Link
          </button>
          <button
            className="px-3 py-2 rounded-md bg-slate-700"
            onClick={handleReset}
          >
            Reset
          </button>

          {/* opponent + spectators badges */}
          <span
            className={`px-2 py-1 rounded text-xs border ${
              opponentJoined
                ? 'bg-green-600/20 border-green-600 text-green-300'
                : 'bg-yellow-600/20 border-yellow-600 text-yellow-200'
            }`}
          >
            {opponentJoined ? 'Opponent: joined' : 'Opponent: waiting…'}
          </span>

          <span className="px-2 py-1 rounded text-xs border bg-slate-800 border-slate-600 text-slate-300">
            👁 {spectators}
          </span>
        </div>
      </header>

      {/* You vs Opponent layout with divider */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 items-start">
        {/* You */}
        <section className="space-y-3">
          <h2 className="font-semibold">You</h2>
          <div className="space-y-2">
            {board.map((r, i) => (
              <Row key={i} guess={r.guess} feedback={r.fb} />
            ))}
          </div>
          <form onSubmit={submitGuess} className="flex items-center gap-2 mt-3">
            <input
              ref={inputRef}
              value={input.toUpperCase()}
              onChange={(e) =>
                setInput(
                  e.target.value
                    .replace(/[^a-zA-Z]/g, '')
                    .slice(0, WORD_LEN)
                    .toLowerCase()
                )
              }
              className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700 tracking-widest text-lg uppercase"
              placeholder={'_'.repeat(WORD_LEN)}
              autoFocus
            />
            <button
              className="px-3 py-2 rounded-md bg-green-600"
              disabled={input.length !== WORD_LEN}
            >
              Guess
            </button>
          </form>
          {!!status && (
            <p className="text-sm text-slate-300 mt-1 transition-all">{status}</p>
          )}
        </section>

        {/* Divider */}
        <div
          className="hidden md:block w-px self-stretch bg-slate-700"
          aria-hidden="true"
        />
        <div className="md:hidden h-px bg-slate-700 my-2" aria-hidden="true" />

        {/* Opponent */}
        <section className="space-y-3">
          <h2 className="font-semibold">Opponent</h2>
          <div className="space-y-2">
            {otherBoard.map((r, i) => (
              <Row key={i} guess={" "} feedback={r.fb} />
            ))}
          </div>

          {/* Typing progress boxes */}
          {otherTyping > 0 && (
            <div className="flex justify-center gap-2 h-10">
              {Array.from({ length: WORD_LEN }).map((_, i) => (
                <div
                  key={i}
                  className={`w-10 h-10 rounded-md border border-slate-700 ${
                    i < otherTyping ? 'bg-slate-500' : 'bg-slate-800'
                  }`}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="mt-8 text-sm text-slate-400">
        Share your room link with a friend. First two joiners become players;
        others are spectators.
      </footer>
    </div>
  )
}
