import { useState, useEffect, useRef, useCallback } from 'react'

// =============================================================================
// CORE CA FRAMEWORK
// =============================================================================

function ruleToDict(ruleNumber) {
  const binary = ruleNumber.toString(2).padStart(8, '0').split('').reverse()
  const dict = {}
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      for (let c = 0; c < 2; c++) {
        const idx = 4 * a + 2 * b + c
        dict[`${a}${b}${c}`] = parseInt(binary[idx])
      }
    }
  }
  return dict
}

function applyRule(state, ruleDict) {
  const n = state.length
  const newState = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const left = state[(i - 1 + n) % n]
    const center = state[i]
    const right = state[(i + 1) % n]
    newState[i] = ruleDict[`${left}${center}${right}`]
  }
  return newState
}

// D(s) = change mask - which cells flip
function derivative(state, ruleDict) {
  const next = applyRule(state, ruleDict)
  return state.map((v, i) => v ^ next[i])
}

// E(s) = s ⊕ D(s) = evolution
function evolve(state, ruleDict) {
  const D = derivative(state, ruleDict)
  return state.map((v, i) => v ^ D[i])
}

// G(s) = D(E(s)) ⊕ E(D(s)) = groovy commutator
function groovyCommutator(state, ruleDict) {
  const Ds = derivative(state, ruleDict)
  const Es = evolve(state, ruleDict)
  
  // Path 1: Evolve then differentiate
  const D_Es = derivative(Es, ruleDict)
  
  // Path 2: Differentiate then evolve  
  const E_Ds = evolve(Ds, ruleDict)
  
  return D_Es.map((v, i) => v ^ E_Ds[i])
}

// G²(s) = G(G(s)) = second-order groovy commutator
// Treating the groovy commutator output as a new state and computing its groove
// "The grooviness of the groove" — how non-commutativity itself is non-commutative
function groovyCommutator2(state, ruleDict) {
  const G = groovyCommutator(state, ruleDict)
  return groovyCommutator(G, ruleDict)
}

function density(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

// =============================================================================
// AWARE CA — cells with memory (can see their S' value)
// =============================================================================

// Extended rule: 4-bit input (left, center, right, didChange) → 16-bit rule number
function awareRuleToDict(ruleNumber) {
  const binary = BigInt(ruleNumber).toString(2).padStart(16, '0').split('').reverse()
  const dict = {}
  for (let l = 0; l < 2; l++) {
    for (let c = 0; c < 2; c++) {
      for (let r = 0; r < 2; r++) {
        for (let d = 0; d < 2; d++) { // d = "did I change last step?"
          const idx = 8 * l + 4 * c + 2 * r + d
          dict[`${l}${c}${r}${d}`] = parseInt(binary[idx])
        }
      }
    }
  }
  return dict
}

// Apply aware rule: cells see their previous S' (change) value
function applyAwareRule(state, prevDerivative, ruleDict) {
  const n = state.length
  const newState = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const left = state[(i - 1 + n) % n]
    const center = state[i]
    const right = state[(i + 1) % n]
    const didChange = prevDerivative ? prevDerivative[i] : 0
    newState[i] = ruleDict[`${left}${center}${right}${didChange}`]
  }
  return newState
}

// Evolve aware CA and track derivative history
function evolveAware(state, prevDeriv, ruleDict) {
  const next = applyAwareRule(state, prevDeriv, ruleDict)
  const deriv = state.map((v, i) => v ^ next[i])
  return { next, deriv }
}

// Groovy commutator for aware CA (more complex - derivative depends on prev derivative)
function groovyCommutatorAware(state, prevDeriv, ruleDict) {
  // This is trickier because the aware rule depends on history
  // For now, compute it assuming the prevDeriv stays constant for both paths
  const { next: Es, deriv: D_at_s } = evolveAware(state, prevDeriv, ruleDict)
  
  // Path 1: evolve, then check what would change
  const { deriv: D_Es } = evolveAware(Es, D_at_s, ruleDict)
  
  // Path 2: apply derivative mask, then evolve
  const Ds = state.map((v, i) => v ^ D_at_s[i])
  const { deriv: afterDs } = evolveAware(Ds, D_at_s, ruleDict)
  const E_Ds = Ds.map((v, i) => v ^ afterDs[i])
  const D_E_Ds = E_Ds.map((v, i) => v ^ afterDs[i]) // derivative after that step
  
  return D_Es.map((v, i) => v ^ D_E_Ds[i])
}

// Generate interesting aware rules by extending standard rules
function standardToAwareRule(rule8bit, memoryBehavior = 'ignore') {
  // memoryBehavior: 'ignore' = same as standard, 'invert' = flip if changed, 'stabilize' = stay if changed
  let rule16 = 0n
  const dict = ruleToDict(rule8bit)
  
  for (let l = 0; l < 2; l++) {
    for (let c = 0; c < 2; c++) {
      for (let r = 0; r < 2; r++) {
        const baseResult = dict[`${l}${c}${r}`]
        for (let d = 0; d < 2; d++) {
          let result = baseResult
          if (d === 1) { // cell changed last step
            if (memoryBehavior === 'invert') result = 1 - result
            else if (memoryBehavior === 'stabilize') result = c // stay same
            else if (memoryBehavior === 'excite') result = 1 // become/stay active
          }
          const idx = 8 * l + 4 * c + 2 * r + d
          if (result) rule16 |= (1n << BigInt(idx))
        }
      }
    }
  }
  return Number(rule16)
}

// =============================================================================
// 2D CA (Game of Life style)
// =============================================================================

function evolve2D(grid, birthRule, surviveRule) {
  const h = grid.length
  const w = grid[0].length
  const newGrid = grid.map(row => new Uint8Array(row.length))
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let neighbors = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue
          const ny = (y + dy + h) % h
          const nx = (x + dx + w) % w
          neighbors += grid[ny][nx]
        }
      }
      
      if (grid[y][x]) {
        newGrid[y][x] = surviveRule.includes(neighbors) ? 1 : 0
      } else {
        newGrid[y][x] = birthRule.includes(neighbors) ? 1 : 0
      }
    }
  }
  return newGrid
}

function derivative2D(grid, birthRule, surviveRule) {
  const next = evolve2D(grid, birthRule, surviveRule)
  return grid.map((row, y) => row.map((v, x) => v ^ next[y][x]))
}

function groovyCommutator2D(grid, birthRule, surviveRule) {
  const Ds = derivative2D(grid, birthRule, surviveRule)
  const Es = evolve2D(grid, birthRule, surviveRule)
  
  const D_Es = derivative2D(Es, birthRule, surviveRule)
  const E_Ds = evolve2D(Ds, birthRule, surviveRule)
  
  return D_Es.map((row, y) => row.map((v, x) => v ^ E_Ds[y][x]))
}

function density2D(grid) {
  let sum = 0, count = 0
  for (const row of grid) {
    for (const v of row) {
      sum += v
      count++
    }
  }
  return sum / count
}

// =============================================================================
// VISUALIZATION
// =============================================================================

function drawCA1D(canvas, history, colorFn) {
  const ctx = canvas.getContext('2d')
  const h = history.length
  const w = history[0]?.length || 1
  
  canvas.width = w
  canvas.height = h
  
  const imageData = ctx.createImageData(w, h)
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const [r, g, b] = colorFn(history[y][x])
      imageData.data[idx] = r
      imageData.data[idx + 1] = g
      imageData.data[idx + 2] = b
      imageData.data[idx + 3] = 255
    }
  }
  
  ctx.putImageData(imageData, 0, 0)
}

function draw2D(canvas, grid, colorFn) {
  const ctx = canvas.getContext('2d')
  const h = grid.length
  const w = grid[0]?.length || 1
  
  canvas.width = w
  canvas.height = h
  
  const imageData = ctx.createImageData(w, h)
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const [r, g, b] = colorFn(grid[y][x])
      imageData.data[idx] = r
      imageData.data[idx + 1] = g
      imageData.data[idx + 2] = b
      imageData.data[idx + 3] = 255
    }
  }
  
  ctx.putImageData(imageData, 0, 0)
}

// Color schemes
const stateColor = v => v ? [255, 255, 255] : [10, 10, 15]
const derivColor = v => v ? [255, 107, 107] : [10, 10, 15]
const groovyColor = v => v ? [0, 212, 170] : [10, 10, 15]
const groovy2Color = v => v ? [147, 112, 219] : [10, 10, 15] // purple for G²

// =============================================================================
// APP
// =============================================================================

export default function App() {
  const [mode, setMode] = useState('1d')
  const [rule, setRule] = useState(110)
  const [width, setWidth] = useState(200)
  const [steps, setSteps] = useState(150)
  const [running, setRunning] = useState(false)
  
  // Aware CA settings
  const [awareMode, setAwareMode] = useState(false)
  const [memoryBehavior, setMemoryBehavior] = useState('ignore')
  const [awareRule, setAwareRule] = useState(null) // computed from rule + behavior
  
  // 1D state
  const [history, setHistory] = useState([])
  const [derivHistory, setDerivHistory] = useState([])
  const [groovyHistory, setGroovyHistory] = useState([])
  const [groovy2History, setGroovy2History] = useState([])
  const [metrics, setMetrics] = useState({ rho: 0, groovyDensity: 0, groovy2Density: 0 })
  
  // 2D state
  const [grid, setGrid] = useState(null)
  const [grid2DSize, setGrid2DSize] = useState(100)
  const [birthRule, setBirthRule] = useState([3])
  const [surviveRule, setSurviveRule] = useState([2, 3])
  
  // Refs for canvases
  const stateCanvas = useRef(null)
  const derivCanvas = useRef(null)
  const groovyCanvas = useRef(null)
  const groovy2Canvas = useRef(null)
  const state2DCanvas = useRef(null)
  const groovy2DCanvas = useRef(null)
  
  // Initialize random state
  const initRandom1D = useCallback(() => {
    const initial = new Uint8Array(width)
    for (let i = 0; i < width; i++) {
      initial[i] = Math.random() > 0.5 ? 1 : 0
    }
    return initial
  }, [width])
  
  const initSingle1D = useCallback(() => {
    const initial = new Uint8Array(width)
    initial[Math.floor(width / 2)] = 1
    return initial
  }, [width])
  
  const initRandom2D = useCallback(() => {
    const g = []
    for (let y = 0; y < grid2DSize; y++) {
      const row = new Uint8Array(grid2DSize)
      for (let x = 0; x < grid2DSize; x++) {
        row[x] = Math.random() > 0.7 ? 1 : 0
      }
      g.push(row)
    }
    return g
  }, [grid2DSize])
  
  // Run 1D CA (standard or aware)
  const run1D = useCallback((initial) => {
    const hist = [initial]
    const dHist = []
    const gHist = []
    const g2Hist = []
    
    let state = initial
    let prevDeriv = null
    let totalRho = 0
    let totalGroovy = 0
    let totalGroovy2 = 0
    
    if (awareMode) {
      // Aware CA: cells see their S' from previous step
      const rule16 = standardToAwareRule(rule, memoryBehavior)
      setAwareRule(rule16)
      const awareDict = awareRuleToDict(rule16)
      
      for (let i = 0; i < steps; i++) {
        const { next, deriv } = evolveAware(state, prevDeriv, awareDict)
        const G = groovyCommutatorAware(state, prevDeriv, awareDict)
        // For aware mode, G² uses standard rule on the G output
        const ruleDict = ruleToDict(rule)
        const G2 = groovyCommutator(G, ruleDict)
        
        dHist.push(deriv)
        gHist.push(G)
        g2Hist.push(G2)
        
        totalRho += density(deriv)
        totalGroovy += density(G)
        totalGroovy2 += density(G2)
        
        prevDeriv = deriv
        state = next
        hist.push(state)
      }
    } else {
      // Standard CA
      const ruleDict = ruleToDict(rule)
      
      for (let i = 0; i < steps; i++) {
        const D = derivative(state, ruleDict)
        const G = groovyCommutator(state, ruleDict)
        const G2 = groovyCommutator2(state, ruleDict)
        
        dHist.push(D)
        gHist.push(G)
        g2Hist.push(G2)
        
        totalRho += density(D)
        totalGroovy += density(G)
        totalGroovy2 += density(G2)
        
        state = evolve(state, ruleDict)
        hist.push(state)
      }
    }
    
    setHistory(hist)
    setDerivHistory(dHist)
    setGroovyHistory(gHist)
    setGroovy2History(g2Hist)
    setMetrics({
      rho: totalRho / steps,
      groovyDensity: totalGroovy / steps,
      groovy2Density: totalGroovy2 / steps
    })
  }, [rule, steps, awareMode, memoryBehavior])
  
  // Draw 1D
  useEffect(() => {
    if (mode === '1d' && history.length > 0) {
      drawCA1D(stateCanvas.current, history, stateColor)
      drawCA1D(derivCanvas.current, derivHistory, derivColor)
      drawCA1D(groovyCanvas.current, groovyHistory, groovyColor)
      drawCA1D(groovy2Canvas.current, groovy2History, groovy2Color)
    }
  }, [mode, history, derivHistory, groovyHistory, groovy2History])
  
  // Draw 2D
  useEffect(() => {
    if (mode === '2d' && grid) {
      draw2D(state2DCanvas.current, grid, stateColor)
      const G = groovyCommutator2D(grid, birthRule, surviveRule)
      draw2D(groovy2DCanvas.current, G, groovyColor)
      
      setMetrics({
        rho: density2D(derivative2D(grid, birthRule, surviveRule)),
        groovyDensity: density2D(G)
      })
    }
  }, [mode, grid, birthRule, surviveRule])
  
  // Animation loop for 2D
  useEffect(() => {
    if (!running || mode !== '2d' || !grid) return
    
    const interval = setInterval(() => {
      setGrid(g => evolve2D(g, birthRule, surviveRule))
    }, 100)
    
    return () => clearInterval(interval)
  }, [running, mode, grid, birthRule, surviveRule])
  
  return (
    <div>
      <h1>🪱 Groovy Commutator Visualizer</h1>
      
      <div className="tabs">
        <button 
          className={`tab ${mode === '1d' ? 'active' : ''}`}
          onClick={() => setMode('1d')}
        >
          1D Cellular Automata
        </button>
        <button 
          className={`tab ${mode === '2d' ? 'active' : ''}`}
          onClick={() => setMode('2d')}
        >
          2D Cellular Automata
        </button>
      </div>
      
      {mode === '1d' && (
        <>
          <div className="controls">
            <div className="control-group">
              <label>Rule (0-255)</label>
              <input 
                type="number" 
                min="0" 
                max="255" 
                value={rule} 
                onChange={e => setRule(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="control-group">
              <label>Width</label>
              <input 
                type="number" 
                min="50" 
                max="500" 
                value={width} 
                onChange={e => setWidth(parseInt(e.target.value) || 200)}
              />
            </div>
            <div className="control-group">
              <label>Steps</label>
              <input 
                type="number" 
                min="50" 
                max="500" 
                value={steps} 
                onChange={e => setSteps(parseInt(e.target.value) || 150)}
              />
            </div>
            <button onClick={() => run1D(initRandom1D())}>
              Random Init
            </button>
            <button className="secondary" onClick={() => run1D(initSingle1D())}>
              Single Cell
            </button>
          </div>
          
          <div className="controls" style={{marginTop: '0.5rem'}}>
            <div className="control-group">
              <label style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                <input 
                  type="checkbox" 
                  checked={awareMode}
                  onChange={e => setAwareMode(e.target.checked)}
                />
                🧠 Aware Mode (cells see S')
              </label>
            </div>
            {awareMode && (
              <div className="control-group">
                <label>Memory Behavior</label>
                <select 
                  value={memoryBehavior} 
                  onChange={e => setMemoryBehavior(e.target.value)}
                >
                  <option value="ignore">Ignore (same as standard)</option>
                  <option value="stabilize">Stabilize (if changed, stay put)</option>
                  <option value="invert">Invert (if changed, flip decision)</option>
                  <option value="excite">Excite (if changed, become active)</option>
                </select>
              </div>
            )}
            {awareMode && awareRule !== null && (
              <div className="control-group">
                <span style={{fontSize: '0.8rem', opacity: 0.7}}>
                  16-bit rule: {awareRule}
                </span>
              </div>
            )}
          </div>
          
          <div className="info">
            <strong>Rule {rule}{awareMode ? ` → Aware (${memoryBehavior})` : ''}</strong> — 
            {awareMode ? (
              <>Cells see whether they changed last step. Try different memory behaviors!</>
            ) : (
              <>Known Class IV: 110, 124, 137, 193. Class III (chaotic): 30, 45, 60, 90. Class I/II: 0, 4, 32, 51.</>
            )}
          </div>
          
          <div className="canvases">
            <div className="canvas-container">
              <h3>State Evolution S(t)</h3>
              <canvas ref={stateCanvas} />
            </div>
            <div className="canvas-container">
              <h3>Derivative D(S) — Change Mask</h3>
              <canvas ref={derivCanvas} />
            </div>
            <div className="canvas-container">
              <h3>Groovy Commutator G(S) = D(E(S)) ⊕ E(D(S))</h3>
              <canvas ref={groovyCanvas} />
            </div>
            <div className="canvas-container">
              <h3>Second-Order G²(S) = G(G(S))</h3>
              <canvas ref={groovy2Canvas} />
            </div>
          </div>
        </>
      )}
      
      {mode === '2d' && (
        <>
          <div className="controls">
            <div className="control-group">
              <label>Grid Size</label>
              <input 
                type="number" 
                min="50" 
                max="200" 
                value={grid2DSize} 
                onChange={e => setGrid2DSize(parseInt(e.target.value) || 100)}
              />
            </div>
            <div className="control-group">
              <label>Birth Rule</label>
              <input 
                type="text" 
                value={birthRule.join(',')} 
                onChange={e => setBirthRule(e.target.value.split(',').map(n => parseInt(n)).filter(n => !isNaN(n)))}
                style={{width: '80px'}}
              />
            </div>
            <div className="control-group">
              <label>Survive Rule</label>
              <input 
                type="text" 
                value={surviveRule.join(',')} 
                onChange={e => setSurviveRule(e.target.value.split(',').map(n => parseInt(n)).filter(n => !isNaN(n)))}
                style={{width: '80px'}}
              />
            </div>
            <button onClick={() => { setGrid(initRandom2D()); setRunning(false); }}>
              Reset Random
            </button>
            <button 
              className={running ? 'secondary' : ''} 
              onClick={() => setRunning(!running)}
            >
              {running ? 'Pause' : 'Run'}
            </button>
            {!running && grid && (
              <button className="secondary" onClick={() => setGrid(evolve2D(grid, birthRule, surviveRule))}>
                Step
              </button>
            )}
          </div>
          
          <div className="info">
            <strong>B{birthRule.join('')}/S{surviveRule.join('')}</strong> — 
            Game of Life: B3/S23. Try HighLife: B36/S23. Day & Night: B3678/S34678.
          </div>
          
          <div className="canvases">
            <div className="canvas-container">
              <h3>State</h3>
              <canvas ref={state2DCanvas} />
            </div>
            <div className="canvas-container">
              <h3>Groovy Commutator G(S)</h3>
              <canvas ref={groovy2DCanvas} />
            </div>
          </div>
        </>
      )}
      
      <div className="metrics">
        <div className="metric">
          <div className="metric-value">{metrics.rho.toFixed(4)}</div>
          <div className="metric-label">ρ (Derivative Density)</div>
        </div>
        <div className="metric">
          <div className="metric-value">{metrics.groovyDensity.toFixed(4)}</div>
          <div className="metric-label">G Density</div>
        </div>
        <div className="metric">
          <div className="metric-value">{(metrics.groovy2Density || 0).toFixed(4)}</div>
          <div className="metric-label">G² Density</div>
        </div>
      </div>
      
      <h2>The Math</h2>
      <div className="info">
        <p><strong>Derivative (Change Mask):</strong> <span className="formula">D(S) = S ⊕ φ(S)</span> — cells that will flip</p>
        <p><strong>Evolution:</strong> <span className="formula">E(S) = S ⊕ D(S)</span> — applying the changes</p>
        <p><strong>Groovy Commutator:</strong> <span className="formula">G(S) = D(E(S)) ⊕ E(D(S))</span></p>
        <p><strong>Second-Order:</strong> <span className="formula">G²(S) = G(G(S))</span> — the grooviness of the groove</p>
        <p style={{marginTop: '1em'}}>
          When G(S) = 0, differentiation and evolution commute — the system is "transparent to scale."<br/>
          When G(S) ≠ 0 with <em>structure</em>, you're at the edge of chaos. That's the signature of aliveness.<br/>
          G² measures how the non-commutativity pattern itself behaves under the same operations.
        </p>
      </div>
    </div>
  )
}
