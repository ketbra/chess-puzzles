// src/board.js
// Browser-only module — not imported in Node; never unit-tested in Phase 1.
import {
  Chessboard,
  COLOR,
  INPUT_EVENT_TYPE,
} from 'cm-chessboard';
import { Markers, MARKER_TYPE } from 'cm-chessboard/src/extensions/markers/Markers.js';

const ASSETS_URL = './vendor/cm-chessboard/assets/';

// Phase 6.3: custom marker types for the king-escape aid. cm-chessboard
// matches markers by reference equality (Marker.matches uses `===` on the
// type object), so each const must be a stable singleton and the SAME
// reference must be used for both addMarker and removeMarkers calls.
const MARKER_KING_ESCAPE  = { class: 'marker-king-escape',  slice: 'markerSquare' };
const MARKER_KING_COVERED = { class: 'marker-king-covered', slice: 'markerSquare' };

export class Board {
  #showLegalMoves = true;   // Phase 6.3: toggleable via setShowLegalMoves
  #showKingEscape = false;  // Phase 6.3: toggleable via setShowKingEscape

  constructor(selector, { onUserMove, onLegalMoves, onKingSurround }) {
    const root = document.querySelector(selector);
    if (!root) throw new Error(`Board: selector ${selector} not found`);
    this.root = root;
    this.userColor = null;
    this.onLegalMoves = onLegalMoves;
    this.onKingSurround = onKingSurround;

    this.cb = new Chessboard(root, {
      assetsUrl: ASSETS_URL,
      orientation: COLOR.white,
      style: {
        cssClass: 'default',
        showCoordinates: true,
        pieces: { type: 'svgSprite', file: 'pieces/staunty.svg' },
      },
      extensions: [{ class: Markers }],
    });

    this.onUserMove = onUserMove;
    this.cb.enableMoveInput((event) => this.#handleInput(event));
  }

  get element() {
    return this.root;
  }

  setUserColor(color) {
    // Accepts 'w'/'b' (chess.js style) or 'white'/'black' (cm-chessboard style).
    this.userColor = color;
  }

  setShowLegalMoves(on) {
    this.#showLegalMoves = !!on;
  }

  setShowKingEscape(on) {
    this.#showKingEscape = !!on;
  }

  setPosition(fen, orientation) {
    if (orientation) {
      this.cb.setOrientation(orientation === 'white' ? COLOR.white : COLOR.black);
    }
    return this.cb.setPosition(fen, false);
  }

  async animateMove({ from, to }) {
    await this.cb.movePiece(from, to, true);
  }

  highlightSquare(square, _kind = 'hint') {
    this.cb.removeMarkers(MARKER_TYPE.frame);
    this.cb.addMarker(MARKER_TYPE.frame, square);
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      this.cb.removeMarkers(MARKER_TYPE.frame);
    }, 2000);
  }

  squareElement(square) {
    return this.root.querySelector(`[data-square="${square}"]`);
  }

  #handleInput(event) {
    if (!this.onUserMove) return false;

    if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
      // Color guard: only user's pieces are pickable. Unconditional — not
      // part of the toggleable aid system.
      if (this.userColor && event.piece) {
        const pieceColor = event.piece[0]; // cm-chessboard pieces are 'wK', 'bN', etc.
        const wantColor = this.userColor === 'white' ? 'w'
                        : this.userColor === 'black' ? 'b'
                        : this.userColor;
        if (pieceColor !== wantColor) return false;
      }
      const square = event.squareFrom ?? event.square;
      // Aid 1: green legal-move dots/rings.
      if (this.#showLegalMoves && this.onLegalMoves) {
        this.#paintLegalMarkers(this.onLegalMoves(square));
      }
      // Aid 2: red/gray king-escape markers.
      if (this.#showKingEscape && this.onKingSurround) {
        this.#paintKingMarkers(this.onKingSurround(square));
      }
      return true;
    }

    if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
      return true; // always accept; game logic validates externally
    }

    if (event.type === INPUT_EVENT_TYPE.moveInputCanceled
     || event.type === INPUT_EVENT_TYPE.moveInputFinished) {
      this.#clearAidMarkers();
    }

    if (event.type === INPUT_EVENT_TYPE.moveInputFinished) {
      const from = event.squareFrom;
      const to = event.squareTo;
      if (from && to && event.legalMove) {
        const move = { from, to };
        if (event.promotion) move.promotion = event.promotion;
        this.onUserMove(move);
      }
    }
    return undefined;
  }

  #paintLegalMarkers(moves) {
    // Clear the legal-move markers (dot/circle) before repainting; leave
    // any king-escape markers intact (they share the same select trigger
    // and were painted in the same #handleInput call if enabled).
    this.cb.removeMarkers(MARKER_TYPE.dot);
    this.cb.removeMarkers(MARKER_TYPE.circle);
    for (const m of moves) {
      if (m.isCapture) {
        this.cb.addMarker(MARKER_TYPE.circle, m.to);
      } else {
        this.cb.addMarker(MARKER_TYPE.dot, m.to);
      }
    }
  }

  #paintKingMarkers({ kingSquare, escapes, covered }) {
    // Mirror of #paintLegalMarkers: each paint method owns its own marker
    // types and clears only those, leaving the other aid's markers intact
    // when both aids are enabled in the same #handleInput call.
    // The king's own square is painted red too — semantically it's a square
    // that must be under attack for mate (in check), unifying with escapes
    // as "squares that need attacking."
    this.cb.removeMarkers(MARKER_KING_ESCAPE);
    this.cb.removeMarkers(MARKER_KING_COVERED);
    if (kingSquare)            this.cb.addMarker(MARKER_KING_ESCAPE,  kingSquare);
    for (const sq of escapes)  this.cb.addMarker(MARKER_KING_ESCAPE,  sq);
    for (const sq of covered)  this.cb.addMarker(MARKER_KING_COVERED, sq);
  }

  #clearAidMarkers() {
    this.cb.removeMarkers(MARKER_TYPE.dot);
    this.cb.removeMarkers(MARKER_TYPE.circle);
    this.cb.removeMarkers(MARKER_KING_ESCAPE);
    this.cb.removeMarkers(MARKER_KING_COVERED);
  }
}
