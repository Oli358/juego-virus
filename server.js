const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const COLORES = ['rojo', 'verde', 'azul', 'amarillo'];
const NOMBRES_ORGANOS = { 'rojo': 'Corazón', 'verde': 'Estómago', 'azul': 'Cerebro', 'amarillo': 'Hueso', 'multicolor': 'Órgano Multi' };

let salas = {}; 
let socketSala = {};

function getNombreLog(color) { return NOMBRES_ORGANOS[color] || color; }

// --- MAZO ---
function crearMazo() {
    let nuevoMazo = [];
    const carta = (tipo, color, efecto) => ({
        id: Math.random().toString(36).substr(2, 9),
        tipo, color, efecto
    });

    COLORES.forEach(c => { for(let i=0; i<5; i++) nuevoMazo.push(carta('organo', c)); });
    nuevoMazo.push(carta('organo', 'multicolor'));
    COLORES.forEach(c => { for(let i=0; i<4; i++) nuevoMazo.push(carta('virus', c)); });
    nuevoMazo.push(carta('virus', 'multicolor'));
    COLORES.forEach(c => { for(let i=0; i<4; i++) nuevoMazo.push(carta('medicina', c)); });
    for(let i=0; i<4; i++) nuevoMazo.push(carta('medicina', 'multicolor'));
    
    nuevoMazo.push(carta('tratamiento', 'especial', 'error'));
    nuevoMazo.push(carta('tratamiento', 'especial', 'guante'));
    for(let i=0; i<3; i++) nuevoMazo.push(carta('tratamiento', 'especial', 'ladron'));
    for(let i=0; i<2; i++) nuevoMazo.push(carta('tratamiento', 'especial', 'contagio'));
    for(let i=0; i<2; i++) nuevoMazo.push(carta('tratamiento', 'especial', 'trasplante'));

    return barajar(nuevoMazo);
}

function barajar(array) { return array.sort(() => Math.random() - 0.5); }

function robarHastaTres(jugador, sala) {
    if (!sala.mazo) sala.mazo = crearMazo();
    while (jugador.mano.length < 3) {
        if (sala.mazo.length === 0) {
            if (sala.descartes.length === 0) break;
            sala.mazo = barajar([...sala.descartes]);
            sala.descartes = [];
            io.to(sala.id).emit('notificacion', "Mazo reciclado ♻️");
        }
        let c = sala.mazo.shift();
        if(c) jugador.mano.push(c); else break;
    }
}

function siguienteTurno(sala) {
    if (sala.listaJugadoresIds.length === 0) return;
    sala.turnoActualIndex = (sala.turnoActualIndex + 1) % sala.listaJugadoresIds.length;
    let nextId = sala.listaJugadoresIds[sala.turnoActualIndex];
    if (!sala.jugadores[nextId]) return siguienteTurno(sala); 
}

function calcularEstadisticas(sala) {
    let statsFinales = [];
    let jugadores = Object.values(sala.jugadores);
    const premios = [
        { key: 'virusLanzados', titulo: '☣️ El Contagiador', desc: 'Mayor nº de virus lanzados' },
        { key: 'medicinasUsadas', titulo: '🛡️ El Inmunólogo', desc: 'Más medicinas usadas' },
        { key: 'organosRobados', titulo: '🦹 El Cleptómano', desc: 'Más órganos robados' },
        { key: 'cartasDescartadas', titulo: '🗑️ El Indeciso', desc: 'Más cartas descartadas' },
        { key: 'organosJugados', titulo: '🥩 El Carnicero', desc: 'Más órganos jugados' },
        { key: 'erroresProvocados', titulo: '🔁 El Caótico', desc: 'Usó Error Médico' }
    ];
    barajar(premios);
    let seleccionados = 0;
    premios.forEach(premio => {
        if (seleccionados >= 3) return;
        jugadores.sort((a, b) => (b.stats[premio.key] || 0) - (a.stats[premio.key] || 0));
        let topPlayer = jugadores[0];
        let valor = topPlayer.stats[premio.key] || 0;
        if (valor > 0) {
            statsFinales.push({ titulo: premio.titulo, jugador: topPlayer.nombre, valor: valor, desc: premio.desc });
            seleccionados++;
        }
    });
    return statsFinales;
}

function actualizarSala(salaId, evento = null, avisoEspecial = null, statsData = null) {
    const sala = salas[salaId];
    if (!sala) return;
    let idTurno = sala.listaJugadoresIds[sala.turnoActualIndex];
    
    io.to(salaId).emit('actualizarEstado', { 
        jugadores: sala.jugadores, lider: sala.lider, turno: idTurno,
        nombreTurno: (sala.jugadores[idTurno]) ? sala.jugadores[idTurno].nombre : "...", 
        evento: evento, avisoEspecial: avisoEspecial, logTexto: sala.ultimaAccionTexto,
        mazoCount: sala.mazo ? sala.mazo.length : 0,       
        ultimaDescartada: sala.descartes.length > 0 ? sala.descartes[sala.descartes.length - 1] : null,
        juegoTerminado: sala.juegoTerminado, ganador: sala.ganadorNombre,
        stats: statsData 
    });
}

function checkVictoria(jugador) {
    if (jugador.cuerpo.length < 4) return false;
    let sanos = 0;
    jugador.cuerpo.forEach(c => { if (c.virus === 0) sanos++; });
    return sanos >= 4;
}

const initStats = () => ({ virusLanzados: 0, medicinasUsadas: 0, organosJugados: 0, organosRobados: 0, cartasDescartadas: 0, erroresProvocados: 0 });

// --- SOCKETS ---
io.on('connection', (socket) => {
    socket.on('crearSala', (n) => {
        let c = Math.floor(100000 + Math.random() * 900000).toString();
        salas[c] = { id: c, estado: 'lobby', jugadores: {}, listaJugadoresIds: [], lider: socket.id, mazo: crearMazo(), descartes: [], turnoActualIndex: 0, juegoTerminado: false, bloqueoAccion: false, ultimaAccionTexto: "Esperando..." };
        unirseASala(socket, c, n);
    });

    socket.on('unirseSala', ({ codigo, nombre }) => {
        if (!salas[codigo]) return socket.emit('errorSala', 'Sala no existe');
        if (salas[codigo].estado === 'jugando') return socket.emit('errorSala', 'Ya empezaron');
        unirseASala(socket, codigo, nombre);
    });

    function unirseASala(socket, codigo, nombre) {
        let sala = salas[codigo]; socket.join(codigo); socketSala[socket.id] = codigo;
        // Emoji por defecto
        sala.jugadores[socket.id] = { 
            id: socket.id, nombre: nombre || "Jugador", 
            mano: [], cuerpo: [], listo: false, revancha: false, emoji: '😎', 
            stats: initStats() 
        };
        sala.listaJugadoresIds.push(socket.id);
        socket.emit('salaUnida', codigo); actualizarSala(codigo);
    }

    // NUEVO: CAMBIAR EMOJI
    socket.on('cambiarEmoji', (nuevoEmoji) => {
        let sala = salas[socketSala[socket.id]];
        if(sala && sala.estado === 'lobby') {
            sala.jugadores[socket.id].emoji = nuevoEmoji;
            actualizarSala(sala.id);
        }
    });

    socket.on('jugadorListo', () => { let s = salas[socketSala[socket.id]]; if(s) { s.jugadores[socket.id].listo = !s.jugadores[socket.id].listo; actualizarSala(s.id); } });

    // --- REVANCHA (CORREGIDO) ---
    socket.on('solicitarRevancha', () => {
        let sala = salas[socketSala[socket.id]];
        if(sala && sala.juegoTerminado) {
            sala.jugadores[socket.id].revancha = true;
            
            // Verificar si todos quieren
            let todosListos = sala.listaJugadoresIds.every(id => sala.jugadores[id].revancha);
            
            if(todosListos) {
                sala.estado = 'jugando'; 
                sala.juegoTerminado = false; 
                sala.bloqueoAccion = false; 
                sala.mazo = crearMazo(); 
                sala.descartes = [];
                sala.ganadorNombre = null; // Limpiar ganador
                sala.listaJugadoresIds = barajar(sala.listaJugadoresIds);
                
                sala.listaJugadoresIds.forEach(id => { 
                    let s = sala.jugadores[id];
                    s.mano = []; 
                    s.cuerpo = []; 
                    s.revancha = false; 
                    // NO BORRAMOS EL EMOJI AQUÍ
                    s.stats = initStats();
                    robarHastaTres(s, sala); 
                });
                io.to(sala.id).emit('juegoIniciado');
            }
            actualizarSala(sala.id);
        }
    });

    socket.on('volverAlLobby', () => {
        let sala = salas[socketSala[socket.id]];
        if(sala) {
            sala.estado = 'lobby'; sala.juegoTerminado = false;
            sala.listaJugadoresIds.forEach(id => { 
                let j = sala.jugadores[id];
                j.mano=[]; j.cuerpo=[]; j.listo=false; j.revancha=false;
                // Mantenemos emoji tambien aqui
            });
            io.to(sala.id).emit('salaUnida', sala.id); 
            actualizarSala(sala.id);
        }
    });

    socket.on('expulsarJugador', (idDestino) => {
        let sala = salas[socketSala[socket.id]];
        if(sala && socket.id === sala.lider && idDestino !== socket.id) {
            io.to(idDestino).emit('expulsado');
            ejecutarDesconexion(sala, idDestino);
        }
    });

    socket.on('iniciarPartida', () => {
        let s = salas[socketSala[socket.id]];
        if(s && socket.id === s.lider) {
            s.estado = 'jugando'; s.juegoTerminado = false; s.bloqueoAccion = false; s.mazo = crearMazo(); s.descartes = [];
            s.listaJugadoresIds = barajar(s.listaJugadoresIds);
            s.listaJugadoresIds.forEach(id => { 
                s.jugadores[id].mano=[]; s.jugadores[id].cuerpo=[]; 
                s.jugadores[id].stats = initStats(); 
                s.jugadores[id].revancha = false;
                robarHastaTres(s.jugadores[id], s); 
            });
            io.to(s.id).emit('juegoIniciado'); actualizarSala(s.id);
        }
    });

    socket.on('jugarCarta', (data) => {
        let sala = salas[socketSala[socket.id]];
        if(!sala || sala.juegoTerminado || sala.bloqueoAccion) return;
        if(socket.id !== sala.listaJugadoresIds[sala.turnoActualIndex]) return;

        let jugador = sala.jugadores[socket.id];
        let carta = jugador.mano[data.indiceCarta];
        let objetivo = sala.jugadores[data.targetId];
        let idxOrgano = (data.organoIndex !== null) ? parseInt(data.organoIndex) : null;
        let organoObj = (idxOrgano !== null && objetivo.cuerpo[idxOrgano]) ? objetivo.cuerpo[idxOrgano] : null;

        if(!carta) return;
        let exito = false, anim = null, msgEspecial = null, fnDiferida = null;

        if(carta.tipo === 'organo') {
            let repetido = objetivo.cuerpo.find(c => c.color === carta.color);
            if(!repetido && objetivo.cuerpo.length < 5) {
                objetivo.cuerpo.push({...carta, virus:0, medicinas:0, inmunizado:false});
                exito = true; sala.ultimaAccionTexto = `${jugador.nombre} puso un ${getNombreLog(carta.color)}`;
                jugador.stats.organosJugados++;
            }
        }
        else if(carta.tipo === 'virus' && organoObj) {
            let colorOk = (carta.color===organoObj.color || carta.color==='multicolor' || organoObj.color==='multicolor');
            if(colorOk && !organoObj.inmunizado) {
                if(organoObj.medicinas > 0) {
                    organoObj.medicinas--; sala.descartes.push(carta); exito=true; anim='destruir_vacuna';
                    sala.ultimaAccionTexto = `${jugador.nombre} destruyó vacuna al ${getNombreLog(organoObj.color)} de ${objetivo.nombre}`;
                } else if(organoObj.virus === 0) {
                    organoObj.virus++; sala.descartes.push(carta); exito=true; anim='infectar';
                    sala.ultimaAccionTexto = `${jugador.nombre} infectó el ${getNombreLog(organoObj.color)} de ${objetivo.nombre}`;
                } else {
                    sala.descartes.push(carta); sala.descartes.push(organoObj);
                    objetivo.cuerpo.splice(idxOrgano, 1);
                    exito=true; anim='extirpar'; 
                    sala.ultimaAccionTexto = `${jugador.nombre} extirpó el ${getNombreLog(organoObj.color)} de ${objetivo.nombre}`;
                }
                jugador.stats.virusLanzados++;
            }
        }
        else if(carta.tipo === 'medicina' && organoObj && socket.id === data.targetId) {
            let colorOk = (carta.color===organoObj.color || carta.color==='multicolor' || organoObj.color==='multicolor');
            if(colorOk) {
                if(organoObj.virus > 0) {
                    organoObj.virus--; sala.descartes.push(carta); exito=true; anim='curar';
                    sala.ultimaAccionTexto = `${jugador.nombre} curó su ${getNombreLog(organoObj.color)}`;
                } else if(organoObj.medicinas < 2) {
                    organoObj.medicinas++; 
                    if(organoObj.medicinas===2) organoObj.inmunizado=true;
                    sala.descartes.push(carta); exito=true; anim=organoObj.inmunizado?'inmunizar':'curar';
                    sala.ultimaAccionTexto = `${jugador.nombre} ${organoObj.inmunizado?'inmunizó':'vacunó'} su ${getNombreLog(organoObj.color)}`;
                }
                jugador.stats.medicinasUsadas++;
            }
        }
        else if(carta.tipo === 'tratamiento') {
            if(carta.efecto === 'guante') {
                msgEspecial = `🧤 GUANTE: Todos descartan.`;
                fnDiferida = () => { sala.listaJugadoresIds.forEach(id=>{ if(id!==socket.id){ let j=sala.jugadores[id]; sala.descartes.push(...j.mano); j.mano=[]; robarHastaTres(j, sala); } }); };
            } else if(carta.efecto === 'error' && socket.id !== data.targetId) {
                msgEspecial = `🔁 ERROR MÉDICO: Cambio de cuerpos entre ${jugador.nombre} y ${objetivo.nombre}.`;
                fnDiferida = () => { let aux=jugador.cuerpo; jugador.cuerpo=objetivo.cuerpo; objetivo.cuerpo=aux; };
                jugador.stats.erroresProvocados++;
            } else if(carta.efecto === 'ladron' && organoObj && socket.id !== data.targetId && !organoObj.inmunizado) {
                 if(!jugador.cuerpo.find(c=>c.color===organoObj.color)) {
                     msgEspecial = `🦹 LADRÓN: ${jugador.nombre} robó el ${getNombreLog(organoObj.color)} a ${objetivo.nombre}.`;
                     fnDiferida = () => { objetivo.cuerpo.splice(idxOrgano, 1); jugador.cuerpo.push(organoObj); };
                     jugador.stats.organosRobados++;
                 }
            } else if(carta.efecto === 'contagio') {
                 if(jugador.cuerpo.some(c=>c.virus>0)) {
                    msgEspecial = `☣️ CONTAGIO MASIVO propagado por ${jugador.nombre}`;
                    fnDiferida = () => {
                        let logContagio = [];
                        jugador.cuerpo.forEach(miOrg => {
                            if (miOrg.virus > 0) {
                                for(let idR in sala.jugadores) {
                                    if(idR === socket.id) continue;
                                    let rival = sala.jugadores[idR];
                                    let indexVictima = rival.cuerpo.findIndex(o => 
                                        (o.color === miOrg.color || o.color === 'multicolor' || miOrg.color === 'multicolor') 
                                        && !o.inmunizado
                                    );
                                    if (indexVictima !== -1) {
                                        let victima = rival.cuerpo[indexVictima];
                                        if(victima.medicinas > 0) { victima.medicinas--; } else {
                                            victima.virus++;
                                            if(victima.virus >= 2) { sala.descartes.push(victima); rival.cuerpo.splice(indexVictima, 1); logContagio.push(`${rival.nombre} perdió su ${getNombreLog(victima.color)}`); }
                                        }
                                        miOrg.virus--; break; 
                                    }
                                }
                            }
                        });
                        if(logContagio.length > 0) sala.ultimaAccionTexto = logContagio.join(', ');
                    };
                    jugador.stats.virusLanzados++;
                 }
            } else if(carta.efecto === 'trasplante' && organoObj && socket.id !== data.targetId) {
                 let miIndice = jugador.cuerpo.findIndex(c => c.color === organoObj.color);
                 if(miIndice !== -1 && !organoObj.inmunizado) {
                     let miOrg = jugador.cuerpo[miIndice];
                     if(!miOrg.inmunizado) {
                         msgEspecial = `🤝 TRASPLANTE: ${jugador.nombre} intercambió su ${getNombreLog(miOrg.color)} con ${objetivo.nombre}.`;
                         fnDiferida = () => { 
                             jugador.cuerpo[miIndice] = organoObj;
                             objetivo.cuerpo[idxOrgano] = miOrg;
                         };
                     }
                 }
            }
            if(msgEspecial) { exito=true; sala.descartes.push(carta); }
        }

        if(exito) {
            jugador.mano.splice(data.indiceCarta, 1);
            robarHastaTres(jugador, sala);
            if(msgEspecial) {
                sala.bloqueoAccion = true;
                actualizarSala(sala.id, {tipo:'nada'}, msgEspecial);
                setTimeout(() => { if(fnDiferida) fnDiferida(); sala.bloqueoAccion=false; checkFin(sala, jugador, objetivo, anim, data); }, 3000);
            } else { checkFin(sala, jugador, objetivo, anim, data); }
        }
    });

    function checkFin(sala, j1, j2, anim, data) {
        let ganador = null;
        if(checkVictoria(j1)) ganador = j1;
        else if(j2 && checkVictoria(j2)) ganador = j2;

        if (ganador) {
            sala.juegoTerminado = true;
            sala.ganadorNombre = ganador.nombre;
            const statsCalculadas = calcularEstadisticas(sala);
            actualizarSala(sala.id, { tipo: 'jugada', animacion: anim, targetId: data.targetId, organoIndex: data.organoIndex }, null, statsCalculadas);
        } else {
            siguienteTurno(sala);
            actualizarSala(sala.id, { tipo: 'jugada', animacion: anim, targetId: data.targetId, organoIndex: data.organoIndex });
        }
    }

    socket.on('descartar', (indices) => {
        let sala = salas[socketSala[socket.id]];
        if(!sala || sala.bloqueoAccion || socket.id!==sala.listaJugadoresIds[sala.turnoActualIndex]) return;
        indices.sort((a,b)=>b-a); let c=0; let j = sala.jugadores[socket.id];
        indices.forEach(i => { if(j.mano[i]) { sala.descartes.push(j.mano[i]); j.mano.splice(i,1); c++; } });
        if(c>0) {
            sala.ultimaAccionTexto=`Descartó ${c} cartas`;
            j.stats.cartasDescartadas += c;
            robarHastaTres(j, sala); siguienteTurno(sala); actualizarSala(sala.id);
        }
    });

    function ejecutarDesconexion(sala, idJugador) {
        let nombre = sala.jugadores[idJugador] ? sala.jugadores[idJugador].nombre : "Jugador";
        io.to(sala.id).emit('jugadorSalio', { id: idJugador, nombre: nombre });
        sala.ultimaAccionTexto = `${nombre} se ha desconectado.`;

        setTimeout(() => {
            delete sala.jugadores[idJugador];
            sala.listaJugadoresIds = sala.listaJugadoresIds.filter(id => id !== idJugador);
            delete socketSala[idJugador];

            if (sala.listaJugadoresIds.length === 0) {
                delete salas[sala.id];
            } 
            else if (sala.estado === 'jugando' && sala.listaJugadoresIds.length === 1) {
                let ganadorDefault = sala.jugadores[sala.listaJugadoresIds[0]];
                sala.juegoTerminado = true;
                sala.ganadorNombre = ganadorDefault.nombre;
                actualizarSala(sala.id, null, "¡Victoria por abandono! 🏃💨\nTodos huyeron.", []);
                
                setTimeout(() => {
                    if (salas[sala.id]) { 
                        sala.estado = 'lobby'; sala.juegoTerminado = false; sala.ganadorNombre = null;
                        Object.values(sala.jugadores).forEach(j => { j.mano = []; j.cuerpo = []; j.listo = false; j.stats = initStats(); });
                        io.to(sala.id).emit('salaUnida', sala.id);
                        actualizarSala(sala.id);
                    }
                }, 3000);
            } else {
                if (sala.estado === 'jugando') {
                    if (sala.turnoActualIndex >= sala.listaJugadoresIds.length) {
                        sala.turnoActualIndex = 0;
                    }
                }
                actualizarSala(sala.id);
            }
        }, 1000); 
    }

    socket.on('disconnect', () => { 
        let codigo = socketSala[socket.id];
        if (!codigo || !salas[codigo]) return;
        let sala = salas[codigo];
        if (socket.id === sala.lider) {
            let otros = sala.listaJugadoresIds.filter(id => id !== socket.id);
            if (otros.length > 0) sala.lider = otros[0];
        }
        ejecutarDesconexion(sala, socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Servidor listo en el puerto ${PORT}`));