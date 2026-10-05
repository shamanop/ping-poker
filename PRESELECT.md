# Pre-select protocol (server side, implemented in server.js)

## Client -> server
Socket.io event `preselect`:

    { roomId, mode: 'checkfold' }              // check if free, else fold
    { roomId, mode: 'call', amount: N }        // call exactly N (N must equal the current to-call)
    { roomId, mode: null }  (or 'none')        // clear my pre-select

- `amount` must be a JS number; for `call` it must equal what you owe right now (currentBet - your roundBet, > 0). No "call any".
- Accepted only while seated, in a hand (status 'playing'), not folded/all-in/sitting out, and NOT on your turn.
- Anything else (unknown mode, non-numeric amount, wrong amount, your turn, no hand) is rejected: server emits `error { message: 'Pre-select not available' }` and the existing pre-select is left unchanged.
- Re-sending replaces the previous pre-select.

## Server -> client
The private `your_cards` event now carries the player's own pre-select (never sent to others, not in `game_state`):

    your_cards: { cards, myIdx, preselect: { mode: 'checkfold'|'call', amount } | null }

`amount` is the to-call it was made against (0 for checkfold). `your_cards` is re-emitted after every accepted/rejected/cleared change, so the client should just render whatever `preselect` says (null = nothing armed).

## Semantics
- Fires once, ~450 ms after the action reaches the player, then is consumed (`preselect` -> null on the next `your_cards`).
  - `checkfold`: check if to-call is 0, otherwise fold.
  - `call N`: calls only if to-call still equals N; otherwise nothing happens and the player acts manually.
- The pre-select is bound to the hand, street and current bet it was made against. It is cleared immediately (and `your_cards` with `preselect: null` is pushed) when:
  - anyone raises / the current bet changes (so it never acts for a different amount, checkfold included),
  - the street changes or a new hand starts,
  - the player folds, goes all-in, sits out, disconnects, or leaves,
  - the player takes any manual action.

## Tests
`node tests/preselect.js` (port 3218, temp bank); also part of `npm test`.
