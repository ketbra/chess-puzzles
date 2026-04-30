// src/board.js
// Browser-only module — not imported in Node; never unit-tested in Phase 1.
import {
  Chessboard,
  COLOR,
  INPUT_EVENT_TYPE,
} from 'cm-chessboard';
import { Markers, MARKER_TYPE } from 'cm-chessboard/src/extensions/markers/Markers.js';

const ASSETS_URL = '/vendor/cm-chessboard/assets/';

export class Board {
  constructor(selector, { onUserMove }) {
    const root = document.querySelector(selector);
    if (!root) throw new Error(`Board: selector ${selector} not found`);
    this.root = root;

    this.cb = new Chessboard(root, {
      assetsUrl: ASSETS_URL,
      orientation: COLOR.white,
      style: {
        cssClass: 'default',
        showCoordinates: false,
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
      return true; // allow all start squares
    }

    if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
      return true; // always accept; game logic validates externally
    }

    if (event.type === INPUT_EVENT_TYPE.moveInputFinished) {
      const from = event.squareFrom;
      const to = event.squareTo;
      if (from && to && event.legalMove) {
        this.onUserMove({ from, to, promotion: 'q' });
      }
    }
    return undefined;
  }
}
