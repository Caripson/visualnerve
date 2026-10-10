import type { CollaborationMessages } from './en';
const messages = {
  'collaboration.title': 'Collaboration en temps réel',
  'collaboration.intro':
    'Travaillez ensemble sur un diagramme. Le propriétaire approuve chaque appareil ; le contenu est chiffré entre les participants.',
  'collaboration.unavailable':
    'Le service relais n’est pas configuré. Votre espace local fonctionne normalement. Un administrateur doit configurer le service avant de créer ou rejoindre des salles.',
  'collaboration.selectDiagram': 'Ouvrez un diagramme avant de créer une salle.',
  'collaboration.displayName': 'Votre nom affiché',
  'collaboration.nameHint':
    'Les participants choisissent leurs noms ; ce ne sont pas des identités professionnelles vérifiées. Vérifiez l’empreinte de l’appareil par un canal de confiance.',
  'collaboration.create': 'Créer une salle',
  'collaboration.join': 'Rejoindre une salle',
  'collaboration.invitation': 'Lien d’invitation privé',
  'collaboration.inviteHint':
    'Ce lien est secret, à usage unique et limité dans le temps. Le propriétaire doit aussi approuver l’appareil qui rejoint la salle.',
  'collaboration.coreScope':
    'Partage les nœuds, connexions, textes, descriptions, notes et modèle de simulation de ce diagramme. Les autres diagrammes, mots de passe et paramètres de l’espace restent locaux.',
  'collaboration.scopeTitle': 'Inclure des informations supplémentaires',
  'collaboration.metadata': 'Métadonnées personnalisées et ID d’intégration',
  'collaboration.owners': 'Responsables assignés et leurs informations',
  'collaboration.datasets': 'Jeux de données bruts et analyses CSV',
  'collaboration.shareConsent':
    'J’ai vérifié le diagramme et suis autorisé à partager ces informations.',
  'collaboration.createAction': 'Démarrer une salle privée',
  'collaboration.joinAction': 'Demander à rejoindre',
  'collaboration.securityTitle': 'Avant de partager',
  'collaboration.securityBody':
    'Le relais voit les métadonnées de connexion et d’appartenance, pas le contenu ni les clés. Les participants peuvent conserver des copies. Le chiffrement ne protège pas un navigateur déverrouillé et compromis.',
  'collaboration.reloadWarning':
    'Les clés de la session en direct restent en mémoire. Recharger ou verrouiller termine votre session locale. Le propriétaire crée une nouvelle salle ; les autres participants ont besoin d’une nouvelle invitation et approbation.',
  'collaboration.backupWarning':
    'Retirer un participant ou changer un mot de passe ne révoque pas les captures, exports, sauvegardes ni informations déjà copiées.',
  'collaboration.joinWarning':
    'Vérifiez l’invitation et le propriétaire par un canal de confiance. Rejoindre crée un diagramme local séparé ; vos autres diagrammes ne sont pas partagés.',
  'collaboration.copy': 'Copier l’invitation privée',
  'collaboration.copied': 'Invitation copiée. Partagez-la par un canal privé de confiance.',
  'collaboration.copyFailed':
    'Le navigateur n’a pas pu copier le lien. Sélectionnez-le et copiez-le manuellement.',
  'collaboration.newInvitation': 'Créer une invitation à usage unique',
  'collaboration.expires': 'Expire : {date}',
  'collaboration.participants': 'Participants dans cette salle',
  'collaboration.pending': 'En attente de votre approbation',
  'collaboration.fingerprint': 'Empreinte de l’appareil',
  'collaboration.compareFingerprint':
    'Comparez l’empreinte complète avec la personne par un canal de confiance avant de l’approuver.',
  'collaboration.approve': 'Approuver l’appareil',
  'collaboration.reject': 'Refuser la demande',
  'collaboration.role': 'Autorisation',
  'collaboration.role.owner': 'Propriétaire',
  'collaboration.role.editor': 'Éditeur',
  'collaboration.role.viewer': 'Lecteur',
  'collaboration.roleHint':
    'Les éditeurs modifient le diagramme. Les lecteurs le consultent. Seul le propriétaire approuve les appareils et modifie les autorisations.',
  'collaboration.self': 'Vous',
  'collaboration.online': 'Connecté',
  'collaboration.offline': 'Déconnecté',
  'collaboration.selected': 'Nœuds sélectionnés : {count}',
  'collaboration.agent': 'Agent MCP',
  'collaboration.remove': 'Retirer le participant',
  'collaboration.leave': 'Quitter la salle',
  'collaboration.closeRoom': 'Fermer la salle pour tous',
  'collaboration.confirmTitle': 'Confirmer le changement',
  'collaboration.confirmRemove':
    'Retirer {name} ? Cet appareil perd l’accès aux futurs messages. Les copies déjà reçues ne peuvent pas être rappelées.',
  'collaboration.confirmChangeRole':
    'Attribuer à {name} l’autorisation {role} ? Elle s’applique aux futures actions dans cette salle.',
  'collaboration.confirmReject':
    'Refuser la demande de cet appareil ? Une nouvelle invitation sera nécessaire pour réessayer.',
  'collaboration.confirmLeave':
    'Quitter la salle en direct ? Votre diagramme local enregistré reste disponible. Revenir nécessite une nouvelle invitation et approbation.',
  'collaboration.confirmClose':
    'Fermer la salle pour tous ? Tous les participants seront déconnectés. Les diagrammes locaux enregistrés et les copies restent disponibles.',
  'collaboration.confirm': 'Confirmer le changement',
  'collaboration.cancel': 'Annuler',
  'collaboration.busy': 'Traitement…',
  'collaboration.reconnect': 'Reconnecter la session en direct',
  'collaboration.errorTitle': 'La collaboration demande votre attention',
  'collaboration.syncProgress': 'Synchronisation : {completed} sur {total} parties',
  'collaboration.status.idle': 'Espace local',
  'collaboration.status.connecting': 'Connexion',
  'collaboration.status.awaiting-approval': 'En attente de l’approbation du propriétaire',
  'collaboration.status.syncing': 'Synchronisation du diagramme',
  'collaboration.status.live': 'En direct',
  'collaboration.status.offline': 'Hors ligne · synchronisation suspendue',
  'collaboration.status.conflict': 'Changements à vérifier · synchronisation suspendue',
  'collaboration.status.error': 'La connexion demande votre attention',
  'collaboration.sharing': 'Inclus dans cette salle',
  'collaboration.room': 'Salle : {id}',
  'collaboration.ownerFingerprint': 'Empreinte de l’appareil du propriétaire',
  'collaboration.selfFingerprint': 'Empreinte de votre appareil',
  'collaboration.selfFingerprintHint':
    'Transmettez cette empreinte complète au propriétaire par un canal de confiance distinct avant son approbation.',
  'collaboration.recoveryCopy':
    'Vos modifications non envoyées ont été conservées dans un diagramme local de récupération : « {name} ». Retrouvez-le dans {projects}. Le diagramme partagé suit désormais la version actuelle du propriétaire.',
  'collaboration.open': 'Ouvrir collaboration et participants',
  'collaboration.action': 'Collaboration',
  'collaboration.requiresEncryption':
    'La collaboration en direct nécessite l’espace de travail de l’application chiffrée. Vous pouvez continuer à modifier vos diagrammes locaux ici. Ouvrir l’application chiffrée ne déplace ni ne partage vos diagrammes existants.',
  'collaboration.openEncryptedApp': 'Ouvrir l’application chiffrée',
  'collaboration.connectedCount': '{count} connectés',
} satisfies CollaborationMessages;
export default messages;
