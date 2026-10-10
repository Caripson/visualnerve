import type { CollaborationMessages } from './en';
const messages = {
  'collaboration.title': 'Colaboración en tiempo real',
  'collaboration.intro':
    'Trabaja con otras personas en un diagrama. El propietario aprueba cada dispositivo; el contenido se cifra entre los participantes.',
  'collaboration.unavailable':
    'El servicio de retransmisión no está configurado. Tu espacio local funciona normalmente. Un administrador debe configurar el servicio antes de crear salas o unirse a ellas.',
  'collaboration.selectDiagram': 'Abre un diagrama antes de crear una sala.',
  'collaboration.displayName': 'Tu nombre visible',
  'collaboration.nameHint':
    'Los participantes eligen sus nombres; no son identidades empresariales verificadas. Comprueba la huella del dispositivo por un canal de confianza.',
  'collaboration.create': 'Crear una sala',
  'collaboration.join': 'Unirse a una sala',
  'collaboration.invitation': 'Enlace de invitación privado',
  'collaboration.inviteHint':
    'Este enlace es secreto, de un solo uso y tiene fecha de caducidad. El propietario también debe aprobar el dispositivo que se une.',
  'collaboration.coreScope':
    'Comparte los nodos, conexiones, textos, descripciones, notas y modelo de simulación de este diagrama. Los demás diagramas, contraseñas y ajustes del espacio permanecen locales.',
  'collaboration.scopeTitle': 'Incluir información adicional',
  'collaboration.metadata': 'Metadatos personalizados e ID de integración',
  'collaboration.owners': 'Responsables asignados y sus datos',
  'collaboration.datasets': 'Datos originales y análisis de CSV',
  'collaboration.shareConsent':
    'He revisado el diagrama y tengo permiso para compartir esta información.',
  'collaboration.createAction': 'Iniciar sala privada',
  'collaboration.joinAction': 'Solicitar acceso',
  'collaboration.securityTitle': 'Antes de compartir',
  'collaboration.securityBody':
    'El servicio ve metadatos de conexión y membresía, no el contenido del diagrama ni las claves de cifrado. Los participantes pueden guardar copias. El cifrado no protege un navegador desbloqueado y comprometido.',
  'collaboration.reloadWarning':
    'Las claves de la sesión en vivo permanecen en memoria. Recargar o bloquear termina tu sesión local. Los propietarios crean una nueva sala; los demás participantes necesitan una nueva invitación y aprobación.',
  'collaboration.backupWarning':
    'Eliminar a un participante o cambiar una contraseña no revoca capturas, exportaciones, copias de seguridad ni información ya copiada.',
  'collaboration.joinWarning':
    'Comprueba la invitación y al propietario por un canal de confianza. Al unirte se crea un diagrama local separado; tus otros diagramas no se comparten.',
  'collaboration.copy': 'Copiar invitación privada',
  'collaboration.copied': 'Invitación copiada. Compártela por un canal privado de confianza.',
  'collaboration.copyFailed':
    'El navegador no pudo copiar el enlace. Selecciónalo y cópialo manualmente.',
  'collaboration.newInvitation': 'Crear invitación de un solo uso',
  'collaboration.expires': 'Caduca: {date}',
  'collaboration.participants': 'Personas en esta sala',
  'collaboration.pending': 'Esperando tu aprobación',
  'collaboration.fingerprint': 'Huella del dispositivo',
  'collaboration.compareFingerprint':
    'Compara la huella completa con la persona por un canal de confianza antes de aprobar.',
  'collaboration.approve': 'Aprobar dispositivo',
  'collaboration.reject': 'Rechazar solicitud',
  'collaboration.role': 'Permiso',
  'collaboration.role.owner': 'Propietario',
  'collaboration.role.editor': 'Editor',
  'collaboration.role.viewer': 'Lector',
  'collaboration.roleHint':
    'Los editores modifican el diagrama. Los lectores lo consultan. Solo el propietario admite dispositivos y cambia permisos.',
  'collaboration.self': 'Tú',
  'collaboration.online': 'Conectado',
  'collaboration.offline': 'Desconectado',
  'collaboration.selected': 'Nodos seleccionados: {count}',
  'collaboration.agent': 'Agente MCP',
  'collaboration.remove': 'Eliminar participante',
  'collaboration.leave': 'Salir de la sala',
  'collaboration.closeRoom': 'Cerrar sala para todos',
  'collaboration.confirmTitle': 'Confirmar cambio en la sala',
  'collaboration.confirmRemove':
    '¿Eliminar a {name}? Este dispositivo perderá acceso a los mensajes futuros. Las copias recibidas no pueden recuperarse.',
  'collaboration.confirmChangeRole':
    '¿Cambiar el permiso de {name} a {role}? Se aplicará a las acciones futuras en esta sala.',
  'collaboration.confirmReject':
    '¿Rechazar la solicitud del dispositivo? Necesitará una nueva invitación para intentarlo de nuevo.',
  'collaboration.confirmLeave':
    '¿Salir de la sala en vivo? Tu diagrama local guardado permanece. Para volver necesitas una nueva invitación y aprobación.',
  'collaboration.confirmClose':
    '¿Cerrar la sala para todos? Se desconectará a todos los participantes. Los diagramas locales guardados y las copias permanecen.',
  'collaboration.confirm': 'Confirmar cambio',
  'collaboration.cancel': 'Cancelar',
  'collaboration.busy': 'Procesando…',
  'collaboration.reconnect': 'Reconectar sesión en vivo',
  'collaboration.errorTitle': 'La colaboración requiere atención',
  'collaboration.syncProgress': 'Sincronizando: {completed} de {total} partes',
  'collaboration.status.idle': 'Espacio local',
  'collaboration.status.connecting': 'Conectando',
  'collaboration.status.awaiting-approval': 'Esperando aprobación del propietario',
  'collaboration.status.syncing': 'Sincronizando diagrama',
  'collaboration.status.live': 'En vivo',
  'collaboration.status.offline': 'Sin conexión · sincronización en pausa',
  'collaboration.status.conflict': 'Revisar cambios · sincronización en pausa',
  'collaboration.status.error': 'La conexión requiere atención',
  'collaboration.sharing': 'Incluido en esta sala',
  'collaboration.room': 'Sala: {id}',
  'collaboration.ownerFingerprint': 'Huella del dispositivo del propietario',
  'collaboration.selfFingerprint': 'Huella de tu dispositivo',
  'collaboration.selfFingerprintHint':
    'Comparte esta huella completa con el propietario a través de un canal de confianza independiente antes de la aprobación.',
  'collaboration.recoveryCopy':
    'Tus cambios sin enviar se conservaron en un diagrama local de recuperación: «{name}». Lo encontrarás en {projects}. El diagrama compartido sigue ahora la versión actual del propietario.',
  'collaboration.open': 'Abrir colaboración y participantes',
  'collaboration.action': 'Colaboración',
  'collaboration.requiresEncryption':
    'La colaboración en directo requiere el espacio de trabajo de la aplicación cifrada. Puedes seguir editando tus diagramas locales aquí. Abrir la aplicación cifrada no mueve ni comparte tus diagramas existentes.',
  'collaboration.openEncryptedApp': 'Abrir la aplicación cifrada',
  'collaboration.connectedCount': '{count} conectados',
  'collaboration.copyValue': 'Copiar {label}',
  'collaboration.copyHint': 'Haz clic o toca para copiar.',
  'collaboration.valueCopied': 'Copiado al portapapeles.',
  'collaboration.valueCopyFailed': 'No se pudo copiar. Selecciona el valor y cópialo manualmente.',
  'collaboration.deviceId': 'ID del dispositivo',
  'collaboration.roomId': 'ID de la sala',
} satisfies CollaborationMessages;
export default messages;
