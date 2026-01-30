const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const COLORES = ['rojo', 'verde', 'azul', 'amarillo'];
const NOMBRES_ORGANOS = { 'rojo': 'Corazón', 'verde': 'Estómago', 'azul': 'Cerebro', 'amarillo': 'Hueso', 'multicolor': 'Órgano Multi' };

let salas = {};
let socketSala = {};

function bold(text) { return `<b>${text}</b>`; }
function getNombreLog(color) { return NOMBRES_ORGANOS[color] || color; }

function crearMazo() {
    let nuevoMazo = [];
    const carta = (tipo, color, efecto) => ({ id: Math.random().toString(36).substr(2, 9), tipo, color, efecto });

    COLORES.forEach(c => { for (let i = 0; i < 5; i++) nuevoMazo.push(carta('organo', c)); });
    nuevoMazo.push(carta('organo', 'multicolor'));
    COLORES.forEach(c => { for (let i = 0; i < 4; i++) nuevoMazo.push(carta('virus', c)); });
    nuevoMazo.push(carta('virus', 'multicolor'));
    COLORES.forEach(c => { for (let i = 0; i < 4; i++) nuevoMazo.push(carta('medicina', c)); });
    for (let i = 0; i < 4; i++) nuevoMazo.push(carta('medicina', 'multicolor'));

    nuevoMazo.push(carta('tratamiento', 'especial', 'error'));
    nuevoMazo.push(carta('tratamiento', 'especial', 'guante'));
    for (let i = 0; i < 3; i++) nuevoMazo.push(carta('tratamiento', 'especial', 'ladron'));
    for (let i = 0; i < 2; i++) nuevoMazo.push(carta('tratamiento', 'especial', 'contagio'));
    for (let i = 0; i < 1; i++) nuevoMazo.push(carta('tratamiento', 'especial', 'esterilizacion'));

    return barajar(nuevoMazo);
}

function barajar(array) { return array.sort(() => Math.random() - 0.5); }

function robarHastaTres(jugador, sala) {
    if (!sala.mazo) sala.mazo = crearMazo();
    let loops = 0;
    while (jugador.mano.length < 3 && loops < 100) {
        if (sala.mazo.length === 0) {
            if (sala.descartes.length === 0) break;
            sala.mazo = barajar([...sala.descartes]);
            sala.descartes = [];
            io.to(sala.id).emit('notificacion', "Mazo reciclado ♻️");
        }
        let c = sala.mazo.shift();
        if (c) jugador.mano.push(c);
        loops++;
    }
}

function siguienteTurno(sala) {
    if (sala.listaJugadoresIds.length === 0) return;
    let idx = sala.listaJugadoresIds.indexOf(sala.turno);
    if (idx === -1) idx = 0;
    sala.turno = sala.listaJugadoresIds[(idx + 1) % sala.listaJugadoresIds.length];
}

function calcularEstadisticas(sala) {
    let stats = [];
    let jugadores = Object.values(sala.jugadores);

    let contagiador = jugadores.sort((a, b) => b.stats.virusLanzados - a.stats.virusLanzados)[0];
    if (contagiador && contagiador.stats.virusLanzados >= 0) stats.push({ titulo: '🦠 El Contagiador', jugador: contagiador.nombre, desc: `${contagiador.stats.virusLanzados} virus lanzados` });

    let farma = jugadores.sort((a, b) => b.stats.medicinasUsadas - a.stats.medicinasUsadas)[0];
    if (farma && farma.stats.medicinasUsadas >= 0) stats.push({ titulo: '💊 Farmacéutico', jugador: farma.nombre, desc: `${farma.stats.medicinasUsadas} curas` });

    let ladron = jugadores.sort((a, b) => b.stats.organosRobados - a.stats.organosRobados)[0];
    if (ladron && ladron.stats.organosRobados >= 0) stats.push({ titulo: '🦹 Cleptómano', jugador: ladron.nombre, desc: `${ladron.stats.organosRobados} robos` });

    let indeciso = jugadores.sort((a, b) => b.stats.cartasDescartadas - a.stats.cartasDescartadas)[0];
    if (indeciso && indeciso.stats.cartasDescartadas >= 0) stats.push({ titulo: '🗑️ El Indeciso', jugador: indeciso.nombre, desc: `${indeciso.stats.cartasDescartadas} descartadas` });

    let malaPraxis = jugadores.sort((a, b) => b.stats.erroresProvocados - a.stats.erroresProvocados)[0];
    if (malaPraxis && malaPraxis.stats.erroresProvocados >= 0) stats.push({ titulo: '🔁 Mala Praxis', jugador: malaPraxis.nombre, desc: `${malaPraxis.stats.erroresProvocados} cambios cuerpo` });

    return stats.slice(0, 4);
}

function actualizarSala(salaId, evento = null, statsData = null) {
    const sala = salas[salaId];
    if (!sala) return;

    sala.listaJugadoresIds = sala.listaJugadoresIds.filter(id => sala.jugadores[id]);

    let idTurno = sala.turno || sala.listaJugadoresIds[0];

    let jugadoresPublicos = {};
    Object.keys(sala.jugadores).forEach(id => {
        let j = sala.jugadores[id];
        let sanos = j.cuerpo.filter(c => c.virus === 0).length;
        jugadoresPublicos[id] = {
            id: j.id, nombre: j.nombre, cuerpo: j.cuerpo, manoCount: j.mano.length,
            listo: j.listo, emoji: j.emoji, victorias: j.victorias, revancha: j.revancha,
            organosSanos: sanos
        };
    });

    io.to(salaId).emit('actualizarEstado', {
        jugadores: jugadoresPublicos, lider: sala.lider, turno: idTurno,
        nombreTurno: (sala.jugadores[idTurno]) ? sala.jugadores[idTurno].nombre : "...",
        evento: evento,
        logTexto: sala.ultimaAccionTexto,
        isSpecialLog: sala.isSpecialLog,
        mazoCount: sala.mazo ? sala.mazo.length : 0,
        ultimaDescartada: sala.descartes.length > 0 ? sala.descartes[sala.descartes.length - 1] : null,
        juegoTerminado: sala.juegoTerminado, ganador: sala.ganadorNombre, stats: statsData
    });

    Object.keys(sala.jugadores).forEach(id => {
        io.to(id).emit('mano', sala.jugadores[id].mano);
    });
}

function checkVictoria(jugador) {
    if (jugador.cuerpo.length < 4) return false;
    let sanos = 0;
    let colores = new Set();
    jugador.cuerpo.forEach(c => {
        if (c.virus === 0) {
            sanos++;
            colores.add(c.color);
        }
    });
    return sanos >= 4;
}

const initStats = () => ({ virusLanzados: 0, medicinasUsadas: 0, organosJugados: 0, organosRobados: 0, cartasDescartadas: 0, erroresProvocados: 0 });

io.on('connection', (socket) => {
    socket.on('crearSala', (n) => {
        let c = Math.floor(100000 + Math.random() * 900000).toString();
        salas[c] = { id: c, estado: 'lobby', jugadores: {}, listaJugadoresIds: [], lider: socket.id, mazo: crearMazo(), descartes: [], turnoActualIndex: 0, juegoTerminado: false, bloqueoAccion: false, ultimaAccionTexto: "Esperando...", isSpecialLog: false, turno: null };
        unirseASala(socket, c, n);
    });

    socket.on('unirseSala', ({ codigo, nombre }) => {
        if (!salas[codigo]) return socket.emit('errorSala', 'Sala no existe');
        if (salas[codigo].estado === 'jugando') return socket.emit('errorSala', 'Ya empezaron');
        unirseASala(socket, codigo, nombre);
    });

    function unirseASala(socket, codigo, nombre) {
        let sala = salas[codigo]; socket.join(codigo); socketSala[socket.id] = codigo;
        let existingId = Object.keys(sala.jugadores).find(key => sala.jugadores[key].nombre === nombre);
        if (existingId) { delete sala.jugadores[existingId]; sala.listaJugadoresIds = sala.listaJugadoresIds.filter(id => id !== existingId); }

        sala.jugadores[socket.id] = { id: socket.id, nombre: nombre || "Jugador", mano: [], cuerpo: [], listo: false, revancha: false, emoji: '😎', stats: initStats(), victorias: 0 };
        sala.listaJugadoresIds.push(socket.id);
        socket.emit('salaUnida', codigo); actualizarSala(codigo);
    }

    socket.on('cambiarEmoji', (n) => { let s = salas[socketSala[socket.id]]; if (s && s.estado === 'lobby') { s.jugadores[socket.id].emoji = n; actualizarSala(s.id); } });
    socket.on('jugadorListo', () => { let s = salas[socketSala[socket.id]]; if (s) { s.jugadores[socket.id].listo = !s.jugadores[socket.id].listo; actualizarSala(s.id); } });

    socket.on('iniciarPartida', () => {
        let s = salas[socketSala[socket.id]];
        if (s && socket.id === s.lider && s.listaJugadoresIds.length >= 2) {
            s.estado = 'jugando'; s.juegoTerminado = false; s.bloqueoAccion = false; s.mazo = crearMazo(); s.descartes = [];
            s.listaJugadoresIds = barajar(s.listaJugadoresIds);
            s.ultimaAccionTexto = "¡La partida ha comenzado!"; s.isSpecialLog = false;
            s.listaJugadoresIds.forEach(id => {
                s.jugadores[id].mano = []; s.jugadores[id].cuerpo = []; s.jugadores[id].stats = initStats(); s.jugadores[id].revancha = false;
                robarHastaTres(s.jugadores[id], s);
            });
            s.turno = s.listaJugadoresIds[0];
            io.to(s.id).emit('juegoIniciado');
            actualizarSala(s.id);
        }
    });

    socket.on('jugarCarta', (data) => {
        let sala = salas[socketSala[socket.id]];
        if (!sala || sala.juegoTerminado || sala.bloqueoAccion) return;
        if (sala.turno !== socket.id) return;

        let jugador = sala.jugadores[socket.id];
        let carta = jugador.mano[data.indiceCarta];

        let objetivo = data.targetId ? sala.jugadores[data.targetId] : null;
        let idxOrgano = (data.organoIndex !== null) ? parseInt(data.organoIndex) : null;
        let organoObj = (objetivo && idxOrgano !== null && objetivo.cuerpo[idxOrgano]) ? objetivo.cuerpo[idxOrgano] : null;

        if (!carta) return;
        let exito = false, anim = null, msgEspecial = null, fnDiferida = null, logMsg = "", isSpecial = false;
        let eventoExtraData = null;
        let nombreObjetivo = objetivo ? bold(objetivo.nombre) : 'todos';

        if (carta.tipo === 'organo') {
            if (jugador.cuerpo.length < 5) {
                let repetido = jugador.cuerpo.find(c => c.color === carta.color);
                if (!repetido) {
                    jugador.cuerpo.push({ ...carta, virus: 0, medicinas: 0 });
                    exito = true;
                    logMsg = `${bold(jugador.nombre)} puso un ${bold(getNombreLog(carta.color))}`;
                    jugador.stats.organosJugados++; anim = 'poner_organo';
                } else {
                    socket.emit('notificacion', { mensaje: "⚠️ ¡Ya tienes este órgano!" });
                }
            } else {
                socket.emit('notificacion', { mensaje: "🚫 Tu cuerpo está lleno (Máx 5)." });
            }
        }
        else if (carta.tipo === 'virus' && organoObj) {
            let colorOk = (carta.color === organoObj.color || carta.color === 'multicolor' || organoObj.color === 'multicolor');
            if (colorOk && !organoObj.inmunizado) {
                if (organoObj.medicinas > 0) {
                    organoObj.medicinas--; sala.descartes.push(carta); exito = true; anim = 'destruir_vacuna';
                    logMsg = `${bold(jugador.nombre)} destruyó la medicina del ${bold(getNombreLog(organoObj.color))} de ${bold(nombreObjetivo)}`;
                } else if (organoObj.virus === 0) {
                    organoObj.virus++; sala.descartes.push(carta); exito = true; anim = 'infectar';
                    logMsg = `${bold(jugador.nombre)} infectó el ${bold(getNombreLog(organoObj.color))} de ${bold(nombreObjetivo)}`;
                } else {
                    sala.descartes.push(carta); sala.descartes.push(organoObj);
                    let infoExtra = { colorOrgano: organoObj.color };
                    objetivo.cuerpo.splice(idxOrgano, 1); exito = true; anim = 'extirpar';
                    eventoExtraData = infoExtra;
                    logMsg = `${bold(jugador.nombre)} extirpó el ${bold(getNombreLog(organoObj.color))} de ${bold(nombreObjetivo)}`;
                }
                jugador.stats.virusLanzados++;
            } else {
                if (organoObj.inmunizado) socket.emit('notificacion', { mensaje: "🛡️ ¡Ese órgano está INMUNIZADO!" });
                else socket.emit('notificacion', { mensaje: "⚠️ Color incorrecto para este virus." });
            }
        }
        else if (carta.tipo === 'medicina' && organoObj && socket.id === data.targetId) {
            let colorOk = (carta.color === organoObj.color || carta.color === 'multicolor' || organoObj.color === 'multicolor');
            if (colorOk) {
                if (organoObj.virus > 0) {
                    organoObj.virus--; sala.descartes.push(carta); exito = true; anim = 'curar';
                    logMsg = `${bold(jugador.nombre)} curó su ${bold(getNombreLog(organoObj.color))}`;
                } else if (organoObj.medicinas < 2) {
                    organoObj.medicinas++;
                    if (organoObj.medicinas === 2) organoObj.inmunizado = true;
                    sala.descartes.push(carta); exito = true;
                    anim = organoObj.inmunizado ? 'inmunizar' : 'vacunar';
                    if (anim === 'inmunizar') eventoExtraData = { colorOrgano: organoObj.color };
                    if (jugador.nombre === objetivo.nombre) {
                        logMsg = `${bold(jugador.nombre)} ${organoObj.inmunizado ? 'INMUNIZÓ' : 'puso una medicina en'} su ${bold(getNombreLog(organoObj.color))}`;
                    } else {
                        logMsg = `${bold(jugador.nombre)} ${organoObj.inmunizado ? 'INMUNIZÓ' : 'puso una medicina en'} el ${bold(getNombreLog(organoObj.color))} de ${bold(objetivo.nombre)}`;
                    }
                } else {
                    socket.emit('notificacion', { mensaje: "🛡️ ¡Ya está inmunizado!" });
                }
                jugador.stats.medicinasUsadas++;
            } else {
                socket.emit('notificacion', { mensaje: "⚠️ Color incorrecto para esta medicina." });
            }
        }
        else if (carta.tipo === 'tratamiento') {
            isSpecial = true;
            if (carta.efecto === 'guante') {
                msgEspecial = `🧤 ¡GUANTE! ${bold(jugador.nombre)} hizo descartar la mano a ${bold('TODOS')}`;
                fnDiferida = () => { sala.listaJugadoresIds.forEach(id => { if (id !== socket.id) { let j = sala.jugadores[id]; sala.descartes.push(...j.mano); j.mano = []; robarHastaTres(j, sala); } }); };
                anim = 'guante';
            } else if (carta.efecto === 'error' && socket.id !== data.targetId && objetivo) {
                msgEspecial = `🔁 ¡ERROR MÉDICO! ${bold(jugador.nombre)} cambió todo su cuerpo con el de ${bold(nombreObjetivo)}`;
                fnDiferida = () => { let aux = jugador.cuerpo; jugador.cuerpo = objetivo.cuerpo; objetivo.cuerpo = aux; };
                jugador.stats.erroresProvocados++;
                anim = 'errorMedico';
                eventoExtraData = { nombreActor: jugador.nombre, nombreTarget: objetivo.nombre }; // Para mostrar nombres en animacion
            } else if (carta.efecto === 'ladron' && organoObj && socket.id !== data.targetId && !organoObj.inmunizado) {
                if (!jugador.cuerpo.find(c => c.color === organoObj.color)) {
                    msgEspecial = `🦹 ¡LADRÓN! ${bold(jugador.nombre)} robó el ${bold(getNombreLog(organoObj.color))} de ${bold(nombreObjetivo)}`;
                    fnDiferida = () => { objetivo.cuerpo.splice(idxOrgano, 1); jugador.cuerpo.push(organoObj); };
                    jugador.stats.organosRobados++;
                    anim = 'ladron';
                    eventoExtraData = { colorOrgano: organoObj.color };
                } else {
                    socket.emit('notificacion', { mensaje: "🚫 ¡Ya tienes ese órgano!" });
                }
            }
            // Lógica para ESTERILIZACION
            else if (carta.efecto === 'esterilizacion' && data.colorElegido) {
                let colorTarget = data.colorElegido;

                let totalEliminados = 0;
                let jugadores = Object.values(sala.jugadores);
                jugadores.forEach(j => {
                    j.cuerpo.forEach(o => {
                        if (o.color === colorTarget && o.virus > 0) {
                            totalEliminados += o.virus;
                            o.virus = 0;
                        }
                    });
                });

                sala.descartes.push(carta);
                exito = true;
                anim = 'esterilizacion';
                eventoExtraData = { colorOrgano: colorTarget };
                msgEspecial = `🧼 ¡ESTERILIZACIÓN! ${bold(jugador.nombre)} eliminó todos los virus de los organos ${bold(getNombreLog(colorTarget))}`;
            }
            else if (carta.efecto === 'contagio') {
                // REGLA: Solo se puede usar si AL MENOS UN virus mio tiene donde ir
                // 1. Identificar mis organos contagiados
                let misInfectados = jugador.cuerpo.filter(c => c.virus > 0);

                // 2. Buscar si existe al menos un target valido globalmente
                let esPosible = misInfectados.some(miOrg => {
                    return sala.listaJugadoresIds.some(idRival => {
                        if (idRival === socket.id) return false;
                        let rival = sala.jugadores[idRival];
                        // Target valido: Mismo color, NO inmunizado. (Si esta sano se infecta, si esta vacunas se rompe vacuna, si esta infectado se extirpa)
                        return rival.cuerpo.some(orgRival =>
                            !orgRival.inmunizado && (orgRival.color === miOrg.color || orgRival.color === 'multicolor' || miOrg.color === 'multicolor')
                        );
                    });
                });

                if (esPosible) {
                    msgEspecial = `☣️ ¡CONTAGIO! ${bold(jugador.nombre)} esparció sus virus...`;
                    fnDiferida = () => {
                        // Iteramos mis organos infectados y tratamos de pasar el virus
                        // Iteramos mis organos infectados y tratamos de pasar el virus
                        jugador.cuerpo.forEach(miOrg => {
                            if (miOrg.virus > 0) {
                                // Buscar primer rival valido
                                for (const idRival of sala.listaJugadoresIds) {
                                    if (idRival === socket.id) continue;
                                    let rival = sala.jugadores[idRival];
                                    let idxRival = rival.cuerpo.findIndex(o => !o.inmunizado && (o.color === miOrg.color || o.color === 'multicolor' || miOrg.color === 'multicolor'));

                                    if (idxRival !== -1) {
                                        let orgRival = rival.cuerpo[idxRival];
                                        // TRANSFERENCIA: Quito mi virus
                                        miOrg.virus--;

                                        // Aplicar al rival
                                        if (orgRival.medicinas > 0) {
                                            orgRival.medicinas--;
                                        } else if (orgRival.virus === 0) {
                                            orgRival.virus++;
                                        } else {
                                            // YA TIENE VIRUS -> EXTIRPAR (2 virus)
                                            // El organo muere y va al descarte
                                            sala.descartes.push(orgRival);
                                            rival.cuerpo.splice(idxRival, 1);
                                            // No necesitamos data extra mas que saber que paso contagio,
                                            // ya que la animacion "contagio" es global. 
                                            // Podriamos loguear algo si quisieramos, pero el mensaje general basta.
                                        }

                                        // Solo paso 1 virus por organo mio a 1 rival. Break para no duplicar el virus.
                                        break;
                                    }
                                }
                            }
                        });
                    };
                    jugador.stats.virusLanzados += 2;
                    anim = 'contagio';
                } else {
                    socket.emit('notificacion', { mensaje: "🚫 No hay nadie a quien contagiar (o no tienes virus)." });
                }
            } else if (carta.efecto === 'trasplante' && organoObj && socket.id !== data.targetId) {
                // TRASPLANTE MANUAL v2
                // Recibimos data.indiceCarta, data.targetId, data.organoIndex (rival) AND data.organoExtraIndex (mio)
                let miIndice = (data.organoExtraIndex !== undefined && data.organoExtraIndex !== null) ? parseInt(data.organoExtraIndex) : -1;

                // Función aux estados
                const calcEstado = (o) => { if (o.inmunizado) return 3; if (o.medicinas > 0) return 2; if (o.virus === 0) return 1; return 0; };

                if (miIndice >= 0 && miIndice < jugador.cuerpo.length) {
                    let miOrg = jugador.cuerpo[miIndice];

                    // VALIDACIONES
                    // 1. Inmunidad
                    if (miOrg.inmunizado || organoObj.inmunizado) {
                        socket.emit('notificacion', { mensaje: "🚫 No puedes mover órganos inmunizados." });
                    }
                    // 2. Estado (Mio < Suyo)
                    else if (calcEstado(miOrg) >= calcEstado(organoObj)) {
                        socket.emit('notificacion', { mensaje: "🚫 Solo puedes cambiar si tu órgano está PEOR que el rival." });
                    }
                    else {
                        // 3. Conflictos de Color
                        // - Rival recibe MI organo: Check si rival ya tiene ese color (ignorando el que se va)
                        let rivalTieneConflict = objetivo.cuerpo.some((c, idx) => {
                            if (idx === idxOrgano) return false; // El que se va no cuenta
                            return (c.color === miOrg.color && c.color !== 'multicolor' && miOrg.color !== 'multicolor');
                        });

                        // - Yo recibo SU organo: Check si yo ya tengo ese color (ignorando el que doy)
                        let yoTengoConflict = jugador.cuerpo.some((c, idx) => {
                            if (idx === miIndice) return false; // El que doy no cuenta
                            return (c.color === organoObj.color && c.color !== 'multicolor' && organoObj.color !== 'multicolor');
                        });

                        if (!rivalTieneConflict && !yoTengoConflict) {
                            // EXECUTE
                            msgEspecial = `🤝 ${bold(jugador.nombre)} cambió su ${bold(getNombreLog(miOrg.color))} por el ${bold(getNombreLog(organoObj.color))} de ${nombreObjetivo}`;
                            fnDiferida = () => {
                                let temp = jugador.cuerpo[miIndice];
                                jugador.cuerpo[miIndice] = objetivo.cuerpo[idxOrgano];
                                objetivo.cuerpo[idxOrgano] = temp;
                            };
                            eventoExtraData = { miOrganoIndex: miIndice };
                            anim = 'trasplante';
                        } else {
                            socket.emit('notificacion', { mensaje: "🚫 Conflicto de colores (alguien se quedaría con 2 iguales)." });
                        }
                    }
                } else {
                    socket.emit('notificacion', { mensaje: "⚠️ Debes seleccionar TU órgano para cambiar." });
                }
            }
            if (msgEspecial) { exito = true; sala.descartes.push(carta); }
        }

        if (exito) {
            jugador.mano.splice(data.indiceCarta, 1);
            sala.ultimaAccionTexto = msgEspecial || logMsg;
            sala.isSpecialLog = isSpecial;
            sala.bloqueoAccion = true;

            actualizarSala(sala.id, {
                tipo: 'jugada', animacion: anim, targetId: data.targetId, organoIndex: data.organoIndex, actorId: socket.id,
                extra: eventoExtraData
            });

            if (fnDiferida) fnDiferida();

            setTimeout(() => {
                sala.bloqueoAccion = false;
                if (checkVictoria(jugador)) {
                    sala.juegoTerminado = true; sala.ganadorNombre = jugador.nombre;
                    jugador.victorias++;
                    actualizarSala(sala.id, null, calcularEstadisticas(sala));
                } else {
                    siguienteTurno(sala);
                    actualizarSala(sala.id);
                    setTimeout(() => {
                        robarHastaTres(jugador, sala);
                        io.to(jugador.id).emit('mano', jugador.mano);
                        actualizarSala(sala.id);
                    }, 200);
                }
            }, 300);
        }
    });

    socket.on('descartar', (indices) => {
        let sala = salas[socketSala[socket.id]];
        if (!sala || sala.bloqueoAccion) return;
        if (sala.turno !== socket.id) return; // VALDACION TURNO STRICT
        sala.bloqueoAccion = true; // LOCK IMMEDIATE

        let j = sala.jugadores[socket.id];
        indices.sort((a, b) => b - a);
        indices.forEach(i => { if (j.mano[i]) { sala.descartes.push(j.mano[i]); j.mano.splice(i, 1); j.stats.cartasDescartadas++; } });
        sala.ultimaAccionTexto = `${bold(j.nombre)} descartó ${bold(indices.length)} cartas`; sala.isSpecialLog = false;

        siguienteTurno(sala);
        actualizarSala(sala.id);
        setTimeout(() => {
            sala.bloqueoAccion = false; // UNLOCK
            robarHastaTres(j, sala);
            io.to(j.id).emit('mano', j.mano);
            actualizarSala(sala.id);
        }, 200);
    });

    socket.on('solicitarRevancha', () => { let s = salas[socketSala[socket.id]]; if (s && s.juegoTerminado) { s.jugadores[socket.id].revancha = true; if (s.listaJugadoresIds.every(id => s.jugadores[id].revancha)) { s.estado = 'jugando'; s.juegoTerminado = false; s.bloqueoAccion = false; s.mazo = crearMazo(); s.descartes = []; s.ganadorNombre = null; s.listaJugadoresIds = barajar(s.listaJugadoresIds); s.listaJugadoresIds.forEach(id => { let p = s.jugadores[id]; p.mano = []; p.cuerpo = []; p.revancha = false; p.stats = initStats(); robarHastaTres(p, s); }); s.ultimaAccionTexto = "¡Nueva Partida!"; s.isSpecialLog = false; io.to(s.id).emit('juegoIniciado'); } actualizarSala(s.id); } });
    socket.on('volverAlLobby', () => { let s = salas[socketSala[socket.id]]; if (s) { s.estado = 'lobby'; s.juegoTerminado = false; s.listaJugadoresIds.forEach(id => { let p = s.jugadores[id]; p.mano = []; p.cuerpo = []; p.listo = false; p.revancha = false; }); io.to(s.id).emit('salaUnida', s.id); actualizarSala(s.id); } });
    socket.on('expulsarJugador', (id) => { let s = salas[socketSala[socket.id]]; if (s && socket.id === s.lider && id !== socket.id) { io.to(id).emit('expulsado'); ejecutarDesconexion(s, id); } });
    socket.on('disconnect', () => { let c = socketSala[socket.id]; if (!c || !salas[c]) return; let s = salas[c]; if (socket.id === s.lider) { let o = s.listaJugadoresIds.filter(id => id !== socket.id); if (o.length > 0) s.lider = o[0]; } ejecutarDesconexion(s, socket.id); });

    function ejecutarDesconexion(sala, idJugador) {
        let nombre = sala.jugadores[idJugador] ? sala.jugadores[idJugador].nombre : "Jugador";
        io.to(sala.id).emit('jugadorSalio', { id: idJugador, nombre: nombre });
        io.to(sala.id).emit('jugadorAbandono', { id: idJugador, nombre: nombre });
        setTimeout(() => {
            delete sala.jugadores[idJugador];
            sala.listaJugadoresIds = sala.listaJugadoresIds.filter(id => id !== idJugador);
            delete socketSala[idJugador];
            if (sala.listaJugadoresIds.length === 0) { delete salas[sala.id]; }
            else if (sala.estado === 'jugando') {
                if (sala.listaJugadoresIds.length === 1) {
                    let ganadorDefault = sala.jugadores[sala.listaJugadoresIds[0]];
                    sala.juegoTerminado = true; sala.ganadorNombre = ganadorDefault.nombre;
                    actualizarSala(sala.id, null, []);
                    setTimeout(() => { if (salas[sala.id]) { sala.estado = 'lobby'; sala.juegoTerminado = false; sala.ganadorNombre = null; Object.values(sala.jugadores).forEach(j => { j.mano = []; j.cuerpo = []; j.listo = false; j.stats = initStats(); }); io.to(sala.id).emit('salaUnida', sala.id); actualizarSala(sala.id); } }, 3000);
                } else {
                    if (sala.turnoActualIndex >= sala.listaJugadoresIds.length) sala.turnoActualIndex = 0;
                    actualizarSala(sala.id);
                }
            } else { actualizarSala(sala.id); }
        }, 1000);
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server OK ${PORT}`));