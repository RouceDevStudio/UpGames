// Pila de comandos: cada comando sabe hacerse y deshacerse ({ nombre, hacer(), deshacer() }).

export class Historial {
  constructor({ limite = 300, alCambiar = () => {} } = {}) {
    this.pasado = [];
    this.futuro = [];
    this.limite = limite;
    this.alCambiar = alCambiar;
  }

  // Ejecuta el comando y lo guarda. yaHecho: el cambio ya ocurrió (p. ej. al soltar el gizmo).
  hacer(cmd, { yaHecho = false } = {}) {
    if (!yaHecho) cmd.hacer();
    this.pasado.push(cmd);
    if (this.pasado.length > this.limite) this.pasado.shift();
    this.futuro.length = 0;
    this.alCambiar(this);
    return cmd;
  }

  deshacer() {
    const cmd = this.pasado.pop();
    if (!cmd) return null;
    cmd.deshacer();
    this.futuro.push(cmd);
    this.alCambiar(this);
    return cmd;
  }

  rehacer() {
    const cmd = this.futuro.pop();
    if (!cmd) return null;
    cmd.hacer();
    this.pasado.push(cmd);
    this.alCambiar(this);
    return cmd;
  }

  get puedeDeshacer() { return this.pasado.length > 0; }
  get puedeRehacer() { return this.futuro.length > 0; }
}
