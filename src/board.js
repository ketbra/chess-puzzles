// src/board.js
// Browser-only module — not imported in Node; never unit-tested in Phase 1.
import {
  Chessboard,
  COLOR,
  INPUT_EVENT_TYPE,
} from 'cm-chessboard';
import { Markers, MARKER_TYPE } from 'cm-chessboard/src/extensions/markers/Markers.js';

const ASSETS_URL = './vendor/cm-chessboard/assets/';

export class Board {
  constructor(selector, { onUserMove, onLegalMoves }) {
    const root = document.querySelector(selector);
    if (!root) throw new Error(`Board: selector ${selector} not found`);
    this.root = root;
    this.userColor = null;
    this.onLegalMoves = onLegalMoves;

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
      // Color guard: only user's pieces are pickable.
      if (this.userColor && event.piece) {
        const pieceColor = event.piece[0]; // cm-chessboard pieces are 'wK', 'bN', etc.
        const wantColor = this.userColor === 'white' ? 'w'
                        : this.userColor === 'black' ? 'b'
                        : this.userColor;
        if (pieceColor !== wantColor) return false;
      }
      // Paint legal-move markers via the app-supplied callback.
      if (this.onLegalMoves) {
        const square = event.squareFrom ?? event.square;
        const moves = this.onLegalMoves(square);
        this.#paintLegalMarkers(moves);
      }
      return true;
    }

    if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
      return true; // always accept; game logic validates externally
    }

    if (event.type === INPUT_EVENT_TYPE.moveInputCanceled
     || event.type === INPUT_EVENT_TYPE.moveInputFinished) {
      this.#clearLegalMarkers();
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
    this.#clearLegalMarkers();
    for (const m of moves) {
      if (m.isCapture) {
        this.cb.addMarker(MARKER_TYPE.circle, m.to);
      } else {
        this.cb.addMarker(MARKER_TYPE.dot, m.to);
      }
    }
  }

  #clearLegalMarkers() {
    this.cb.removeMarkers(MARKER_TYPE.dot);
    this.cb.removeMarkers(MARKER_TYPE.circle);
  }
}
