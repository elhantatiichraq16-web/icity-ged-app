/** Assemble des classes CSS en ignorant les valeurs vides : cx('a', ok && 'b'). */
export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}
