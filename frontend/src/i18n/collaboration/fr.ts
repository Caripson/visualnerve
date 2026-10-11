import type { CollaborationMessages } from './en';
const messages = {
  'collaboration.authorizationNotice':
    'Le propriétaire doit garder la salle ouverte. Les autorisations sont renouvelées toutes les 10 secondes. Si elles ne peuvent pas être confirmées, le partage s’arrête sous 30 secondes. Votre diagramme local enregistré est conservé.',
  'collaboration.reviewNotice':
    'La collaboration facultative n’a pas fait l’objet d’un audit de sécurité indépendant. Vérifiez le diagramme avant de le partager ; les participants approuvés peuvent conserver des copies. Travaillez localement si les informations ne doivent pas quitter ce navigateur.',
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
    'Partage les nœuds, connexions, textes, descriptions, notes, modèle de simulation, noms/couleurs/photos des profils des participants, commentaires, tâches et activité de ce diagramme. Les autres diagrammes, mots de passe et paramètres de l’espace restent locaux.',
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
  'collaboration.endLocalSession': 'Terminer la session locale',
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
  'collaboration.confirmEndLocalSession':
    'Terminer la session en échec dans ce navigateur ? Votre diagramme local enregistré reste disponible. La salle sur le relais n’est pas fermée et les autres participants ne sont pas déconnectés. Créez une nouvelle salle ou utilisez une nouvelle invitation pour collaborer à nouveau.',
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
  'collaboration.copyValue': 'Copier {label}',
  'collaboration.copyHint': 'Cliquez ou touchez pour copier.',
  'collaboration.valueCopied': 'Copié dans le presse-papiers.',
  'collaboration.valueCopyFailed':
    'Impossible de copier. Sélectionnez la valeur et copiez-la manuellement.',
  'collaboration.deviceId': 'ID de l’appareil',
  'collaboration.roomId': 'ID de la salle',
  'collaboration.document.profiles': 'Profils',
  'collaboration.document.comments': 'Commentaires',
  'collaboration.document.tasks': 'Tâches',
  'collaboration.document.activity': 'Activité',
  'collaboration.document.profileHint':
    'Les profils enregistrés ont des noms et couleurs choisis et sont distincts des appareils de la salle. Ils ne vérifient pas l’identité d’une personne.',
  'collaboration.document.actingProfile': 'Profil actif du document',
  'collaboration.document.chooseProfile':
    'Choisissez un profil du document avant d’ajouter des commentaires ou des tâches.',
  'collaboration.document.createProfile': 'Créer un profil',
  'collaboration.document.profileName': 'Nom du profil',
  'collaboration.document.avatar': 'Image de profil',
  'collaboration.document.avatarHint':
    'PNG, JPEG ou WebP jusqu’à 8 MiB, 32 mégapixels et 16 384 pixels par dimension. Les images enregistrées sont réduites à 256 pixels et 64 KiB au maximum.',
  'collaboration.document.avatarError':
    'Choisissez une image PNG, JPEG ou WebP valide jusqu’à 8 MiB, 32 mégapixels et 16 384 pixels par dimension.',
  'collaboration.document.removeAvatar': 'Retirer l’image de profil',
  'collaboration.document.remove': 'Supprimer',
  'collaboration.document.confirmRemove': 'Confirmer la suppression',
  'collaboration.document.removeHint':
    'Supprimer cette entrée enregistrée ? Cette modification est partagée avec les participants.',
  'collaboration.document.removeUnavailable':
    'Ce profil est utilisé dans le travail du document ou est le profil actif.',
  'collaboration.document.edit': 'Modifier',
  'collaboration.document.commentText': 'Texte du commentaire',
  'collaboration.document.addComment': 'Ajouter un commentaire',
  'collaboration.document.reply': 'Répondre',
  'collaboration.document.resolve': 'Résoudre le fil',
  'collaboration.document.reopen': 'Rouvrir le fil',
  'collaboration.document.resolved': 'Résolu',
  'collaboration.document.open': 'Ouvert',
  'collaboration.document.target': 'Nœud lié',
  'collaboration.document.diagramTarget': 'Diagramme entier',
  'collaboration.document.chooseNode': 'Choisir un nœud',
  'collaboration.document.missingNode': 'Nœud supprimé',
  'collaboration.document.taskTitle': 'Titre de la tâche',
  'collaboration.document.createTask': 'Créer une tâche',
  'collaboration.document.assignee': 'Profil attribué',
  'collaboration.document.unassigned': 'Non attribué',
  'collaboration.document.taskStatus.todo': 'À faire',
  'collaboration.document.taskStatus.in-progress': 'En cours',
  'collaboration.document.taskStatus.done': 'Terminée',
  'collaboration.document.activityHint':
    'L’historique récent et modifiable utilise l’horloge de chaque auteur. Les anciennes entrées sont supprimées ; ce n’est pas un journal d’audit.',
  'collaboration.document.empty': 'Aucune entrée pour le moment.',
  'collaboration.document.pages': 'Pages des entrées',
  'collaboration.document.readOnly':
    'Vous avez un accès en lecture seule à ce travail du document.',
  'collaboration.document.changeFailed': 'La modification n’a pas pu être enregistrée.',
  'collaboration.document.event.created': 'Créé',
  'collaboration.document.event.updated': 'Mis à jour',
  'collaboration.document.event.removed': 'Supprimé',
  'collaboration.document.event.replied': 'Réponse ajoutée',
  'collaboration.document.event.edited': 'Texte modifié',
  'collaboration.document.event.resolved': 'Résolu',
  'collaboration.document.event.reopened': 'Rouvert',
  'collaboration.document.source.ui': 'Éditeur',
  'collaboration.document.source.api': 'API',
  'collaboration.document.source.mcp': 'MCP',
  'collaboration.document.source.import': 'Importation',
  'collaboration.document.source.collaboration': 'Synchronisation en direct',
  'collaboration.roomTab': 'Salle en direct',
  'collaboration.documentTab': 'Travail du document',
  'collaboration.approvalProfile': 'Profil du document',
  'collaboration.approvalNewProfileName': 'Nom du nouveau profil',
} satisfies CollaborationMessages;
export default messages;
