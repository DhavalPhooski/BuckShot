// app/page.js
'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ceigmqyadzdrnpxakoet.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlaWdtcXlhZHpkcm5weGFrb2V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI3NTcxNTAsImV4cCI6MjA2ODMzMzE1MH0.txY4YZkiP9edLsvVhzqPnJHUrh4kWnaq8faIaLUTvxo';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function Game() {
  const [gameState, setGameState] = useState('menu') // menu, hosting, joining, playing
  const [roomKey, setRoomKey] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [gameData, setGameData] = useState(null)
  const [playerId, setPlayerId] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [channel, setChannel] = useState(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    // Generate player ID
    setPlayerId(Math.random().toString(36).substr(2, 9))
  }, [])

  useEffect(() => {
    if (gameData && channel) {
      // Subscribe to game updates
      const subscription = supabase
        .channel('game-updates')
        .on('postgres_changes', 
          { event: 'UPDATE', schema: 'public', table: 'game_sessions' },
          (payload) => {
            if (payload.new.room_key === roomKey) {
              setGameData(payload.new)
            }
          }
        )
        .subscribe()

      return () => {
        subscription.unsubscribe()
      }
    }
  }, [gameData, channel, roomKey])

  const generateRoomKey = () => {
    return Math.random().toString(36).substr(2, 8).toUpperCase()
  }

  const generateBullets = () => {
    const realBullets = Math.floor(Math.random() * 4) + 1 // 1-4 real bullets
    const fakeBullets = Math.floor(Math.random() * 4) + 1 // 1-4 fake bullets
    const bullets = []
    
    for (let i = 0; i < realBullets; i++) {
      bullets.push('real')
    }
    for (let i = 0; i < fakeBullets; i++) {
      bullets.push('fake')
    }
    
    // Shuffle bullets
    for (let i = bullets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[bullets[i], bullets[j]] = [bullets[j], bullets[i]]
    }
    
    return { bullets, realBullets, fakeBullets }
  }

  const hostGame = async () => {
    const key = generateRoomKey()
    const { bullets, realBullets, fakeBullets } = generateBullets()
    
    const firstTurn = Math.random() < 0.5 ? 1 : 2
    
    const gameState = {
      bullets: bullets,
      current_bullets: [...bullets],
      player1_health: 4,
      player2_health: 4,
      current_turn: firstTurn,
      game_status: 'waiting',
      bullet_count: { real: realBullets, fake: fakeBullets },
      show_bullets: true,
      coin_flip_result: firstTurn === 1 ? 'Host' : 'Guest'
    }

    const { data, error } = await supabase
      .from('game_sessions')
      .insert({
        room_key: key,
        host_id: playerId,
        game_state: gameState
      })
      .select()

    if (error) {
      setMessage('Error creating game: ' + error.message)
      return
    }

    setRoomKey(key)
    setGameData(data[0])
    setIsHost(true)
    setGameState('hosting')
    
    // Set up realtime channel
    const gameChannel = supabase.channel(`game-${key}`)
    setChannel(gameChannel)
  }

  const joinGame = async () => {
    if (!roomKey) {
      setMessage('Please enter a room key')
      return
    }

    const { data: existingGame, error } = await supabase
      .from('game_sessions')
      .select('*')
      .eq('room_key', roomKey)
      .single()

    if (error || !existingGame) {
      setMessage('Room not found')
      return
    }

    if (existingGame.guest_id) {
      setMessage('Room is full')
      return
    }

    const updatedGameState = {
      ...existingGame.game_state,
      game_status: 'joined'
    }

    const { data, error: updateError } = await supabase
      .from('game_sessions')
      .update({
        guest_id: playerId,
        game_state: updatedGameState
      })
      .eq('room_key', roomKey)
      .select()

    if (updateError) {
      setMessage('Error joining game: ' + updateError.message)
      return
    }

    setGameData(data[0])
    setIsHost(false)
    setGameState('playing')
    
    // Set up realtime channel
    const gameChannel = supabase.channel(`game-${roomKey}`)
    setChannel(gameChannel)
  }

  const startGame = async () => {
    if (!isHost || !gameData) return

    const updatedGameState = {
      ...gameData.game_state,
      game_status: 'playing',
      show_bullets: true
    }

    const { error } = await supabase
      .from('game_sessions')
      .update({ game_state: updatedGameState })
      .eq('room_key', roomKey)

    if (error) {
      setMessage('Error starting game: ' + error.message)
      return
    }

    // Hide bullets after 3 seconds
    setTimeout(() => {
      updateGameState({
        ...updatedGameState,
        show_bullets: false
      })
    }, 3000)
  }

  const shootAction = async (target) => {
    if (!gameData || gameData.game_state.game_status !== 'playing') return
    
    const currentPlayerTurn = gameData.game_state.current_turn
    const isPlayerTurn = (isHost && currentPlayerTurn === 1) || (!isHost && currentPlayerTurn === 2)
    
    if (!isPlayerTurn) {
      setMessage('Not your turn!')
      return
    }

    const bullets = [...gameData.game_state.current_bullets]
    if (bullets.length === 0) {
      setMessage('No bullets left!')
      return
    }

    const bullet = bullets.shift()
    let newGameState = { ...gameData.game_state }
    newGameState.current_bullets = bullets
    
    let nextTurn = currentPlayerTurn
    let gameStatus = 'playing'
    
    if (target === 'self') {
      if (bullet === 'real') {
        // Hit self with real bullet - lose health and switch turn
        if (currentPlayerTurn === 1) {
          newGameState.player1_health -= 1
          if (newGameState.player1_health <= 0) {
            gameStatus = 'finished'
          }
        } else {
          newGameState.player2_health -= 1
          if (newGameState.player2_health <= 0) {
            gameStatus = 'finished'
          }
        }
        nextTurn = currentPlayerTurn === 1 ? 2 : 1
      }
      // If fake bullet, same player gets another turn
    } else {
      // Shooting opponent
      if (bullet === 'real') {
        // Hit opponent with real bullet - opponent loses health, opponent gets turn
        if (currentPlayerTurn === 1) {
          newGameState.player2_health -= 1
          if (newGameState.player2_health <= 0) {
            gameStatus = 'finished'
          }
        } else {
          newGameState.player1_health -= 1
          if (newGameState.player1_health <= 0) {
            gameStatus = 'finished'
          }
        }
        nextTurn = currentPlayerTurn === 1 ? 2 : 1
      } else {
        // Hit opponent with fake bullet - opponent gets turn
        nextTurn = currentPlayerTurn === 1 ? 2 : 1
      }
    }
    
    // If no bullets left and game not finished, generate new bullets
    if (bullets.length === 0 && gameStatus !== 'finished') {
      const { bullets: newBullets, realBullets, fakeBullets } = generateBullets()
      newGameState.current_bullets = newBullets
      newGameState.bullet_count = { real: realBullets, fake: fakeBullets }
      newGameState.show_bullets = true
      
      // Hide bullets after 3 seconds
      setTimeout(() => {
        updateGameState({
          ...newGameState,
          show_bullets: false
        })
      }, 3000)
    }
    
    newGameState.current_turn = nextTurn
    newGameState.game_status = gameStatus
    newGameState.last_action = {
      player: currentPlayerTurn,
      target: target,
      bullet: bullet,
      timestamp: Date.now()
    }
    
    await updateGameState(newGameState)
  }

  const updateGameState = async (newGameState) => {
    const { error } = await supabase
      .from('game_sessions')
      .update({ game_state: newGameState })
      .eq('room_key', roomKey)

    if (error) {
      setMessage('Error updating game: ' + error.message)
    }
  }

  const resetGame = async () => {
    const { bullets, realBullets, fakeBullets } = generateBullets()
    const firstTurn = Math.random() < 0.5 ? 1 : 2
    
    const newGameState = {
      bullets: bullets,
      current_bullets: [...bullets],
      player1_health: 4,
      player2_health: 4,
      current_turn: firstTurn,
      game_status: 'playing',
      bullet_count: { real: realBullets, fake: fakeBullets },
      show_bullets: true,
      coin_flip_result: firstTurn === 1 ? 'Host' : 'Guest'
    }

    await updateGameState(newGameState)
    
    setTimeout(() => {
      updateGameState({
        ...newGameState,
        show_bullets: false
      })
    }, 3000)
  }

  if (gameState === 'menu') {
    return (
      <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
        <h1>Buckshot Roulette</h1>
        <div style={{ marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="Your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            style={{ padding: '10px', marginRight: '10px', width: '200px' }}
          />
        </div>
        <div>
          <button
            onClick={hostGame}
            style={{ padding: '10px 20px', marginRight: '10px', fontSize: '16px' }}
          >
            Host Game
          </button>
          <button
            onClick={() => setGameState('joining')}
            style={{ padding: '10px 20px', fontSize: '16px' }}
          >
            Join Game
          </button>
        </div>
        {message && <p style={{ color: 'red', marginTop: '10px' }}>{message}</p>}
      </div>
    )
  }

  if (gameState === 'joining') {
    return (
      <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
        <h1>Join Game</h1>
        <div style={{ marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="Room Key"
            value={roomKey}
            onChange={(e) => setRoomKey(e.target.value.toUpperCase())}
            style={{ padding: '10px', marginRight: '10px', width: '200px' }}
          />
          <button
            onClick={joinGame}
            style={{ padding: '10px 20px', fontSize: '16px' }}
          >
            Join
          </button>
        </div>
        <button
          onClick={() => setGameState('menu')}
          style={{ padding: '10px 20px', fontSize: '16px' }}
        >
          Back
        </button>
        {message && <p style={{ color: 'red', marginTop: '10px' }}>{message}</p>}
      </div>
    )
  }

  if (gameState === 'hosting') {
    return (
      <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
        <h1>Hosting Game</h1>
        <h2>Room Key: {roomKey}</h2>
        
        {/* Show bullet counts while hosting */}
        {gameData && gameData.game_state.show_bullets && (
          <div style={{ 
            backgroundColor: '#f0f0f0', 
            padding: '15px', 
            marginBottom: '20px',
            border: '2px solid #333',
            borderRadius: '5px'
          }}>
            <h3>Bullets in Chamber:</h3>
            <p style={{color: '#d32f2f', fontWeight: 'bold'}}>Real: {gameData.game_state.bullet_count.real} 🔴</p>
            <p style={{color: '#1976d2', fontWeight: 'bold'}}>Fake: {gameData.game_state.bullet_count.fake} ⚪</p>
            <p style={{fontSize: '14px', color: '#666'}}>Total: {gameData.game_state.bullet_count.real + gameData.game_state.bullet_count.fake} bullets</p>
          </div>
        )}

        <p>Waiting for player to join...</p>
        {gameData && gameData.game_state.game_status === 'joined' && (
          <div>
            <p>Player joined! Ready to start?</p>
            <button
              onClick={startGame}
              style={{ padding: '10px 20px', fontSize: '16px' }}
            >
              Start Game
            </button>
          </div>
        )}
        {gameData && gameData.game_state.game_status === 'playing' && (
          <div>
            <p>Game Started!</p>
            <button
              onClick={() => setGameState('playing')}
              style={{ padding: '10px 20px', fontSize: '16px' }}
            >
              Enter Game
            </button>
          </div>
        )}
      </div>
    )
  }

  if (gameState === 'playing' && gameData) {
    const gs = gameData.game_state
    const isPlayerTurn = (isHost && gs.current_turn === 1) || (!isHost && gs.current_turn === 2)
    const playerHealth = isHost ? gs.player1_health : gs.player2_health
    const opponentHealth = isHost ? gs.player2_health : gs.player1_health
    const currentPlayerName = gs.current_turn === 1 ? 'Host' : 'Guest'
    
    return (
      <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
        <h1>Buckshot Roulette - Room: {roomKey}</h1>
        
        <div style={{ marginBottom: '20px' }}>
          <p>You are: {isHost ? 'Host' : 'Guest'}</p>
          <p>Your Health: {playerHealth} ❤️</p>
          <p>Opponent Health: {opponentHealth} ❤️</p>
        </div>

        {/* Show bullet counts when new round starts or when bullets are revealed */}
        {gs.show_bullets && (
          <div style={{ 
            backgroundColor: '#f0f0f0', 
            padding: '15px', 
            marginBottom: '20px',
            border: '2px solid #333',
            borderRadius: '5px'
          }}>
            <h3>New Round - Bullets in Chamber:</h3>
            <p style={{color: '#d32f2f', fontWeight: 'bold'}}>Real: {gs.bullet_count.real} 🔴</p>
            <p style={{color: '#1976d2', fontWeight: 'bold'}}>Fake: {gs.bullet_count.fake} ⚪</p>
            <p style={{fontSize: '14px', color: '#666'}}>Total: {gs.bullet_count.real + gs.bullet_count.fake} bullets</p>
            <p style={{fontSize: '12px', color: '#999', fontStyle: 'italic'}}>This information will disappear in 3 seconds...</p>
          </div>
        )}

        {gs.coin_flip_result && (
          <div style={{ marginBottom: '20px' }}>
            <p>Coin Flip Winner: {gs.coin_flip_result} goes first!</p>
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <p>Current Turn: {currentPlayerName}</p>
          <p>Bullets Left: {gs.current_bullets.length}</p>
        </div>

        {gs.last_action && (
          <div style={{ 
            backgroundColor: '#e8f4f8', 
            padding: '10px', 
            marginBottom: '20px',
            border: '1px solid #333',
            borderRadius: '5px'
          }}>
            <p>Last Action: Player {gs.last_action.player} shot {gs.last_action.target} with {gs.last_action.bullet} bullet</p>
          </div>
        )}

        {gs.game_status === 'playing' && isPlayerTurn && (
          <div style={{ marginBottom: '20px' }}>
            <h3>Your Turn - Choose Action:</h3>
            <button
              onClick={() => shootAction('self')}
              style={{ 
                padding: '15px 30px', 
                fontSize: '18px', 
                marginRight: '10px',
                backgroundColor: '#ff9999',
                borderRadius: '5px',
                border: '1px solid #333'
              }}
            >
              Shoot Self
            </button>
            <button
              onClick={() => shootAction('opponent')}
              style={{ 
                padding: '15px 30px', 
                fontSize: '18px',
                backgroundColor: '#99ff99',
                borderRadius: '5px',
                border: '1px solid #333'
              }}
            >
              Shoot Opponent
            </button>
          </div>
        )}

        {gs.game_status === 'playing' && !isPlayerTurn && (
          <div style={{ marginBottom: '20px' }}>
            <h3>Waiting for opponent's turn...</h3>
          </div>
        )}

        {gs.game_status === 'finished' && (
          <div style={{ marginBottom: '20px' }}>
            <h2>Game Over!</h2>
            <p>Winner: {gs.player1_health > 0 ? 'Host' : 'Guest'}</p>
            {isHost && (
              <button
                onClick={resetGame}
                style={{ 
                  padding: '15px 30px', 
                  fontSize: '18px',
                  backgroundColor: '#ffff99',
                  borderRadius: '5px',
                  border: '1px solid #333'
                }}
              >
                New Game
              </button>
            )}
          </div>
        )}

        <button
          onClick={() => setGameState('menu')}
          style={{ 
            padding: '10px 20px', 
            fontSize: '16px',
            borderRadius: '5px',
            border: '1px solid #333'
          }}
        >
          Leave Game
        </button>

        {message && <p style={{ color: 'red', marginTop: '10px' }}>{message}</p>}
      </div>
    )
  }

  return <div>Loading...</div>
}