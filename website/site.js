const examples = [
  { move: '3. Bc4', caption: 'Develop the bishop and keep an eye on f7.', alt: 'Italian Game position after 3. Bc4: White develops the bishop toward f7.' },
  { move: '3… Bc5', caption: 'Black develops a bishop too, reaching the Giuoco Piano.', alt: 'Italian Game position after 3… Bc5: Black develops the bishop from f8 to c5.' },
  { move: '4. c3', caption: 'White prepares a central pawn advance with d4.', alt: 'Italian Game position after 4. c3: White moves the pawn from c2 to c3.' },
];

document.querySelectorAll('[data-position]').forEach(button => {
  button.addEventListener('click', () => {
    const index = Number(button.dataset.position);
    const example = examples[index];
    const board = document.getElementById('demo-board');
    board.src = `assets/position-${index}.svg`;
    board.alt = example.alt;
    document.querySelector('.preview-bottom .pill').textContent = example.move;
    document.getElementById('demo-caption').textContent = `Illustrative opening study · ${example.caption}`;
    document.querySelectorAll('[data-position]').forEach(other => {
      other.setAttribute('aria-pressed', String(other === button));
    });
  });
});
