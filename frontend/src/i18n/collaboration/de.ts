import type { CollaborationMessages } from './en';
const messages = {
  'collaboration.reviewNotice':
    'Die optionale Zusammenarbeit wurde nicht unabhängig sicherheitsgeprüft. Prüfen Sie das Diagramm vor dem Teilen; zugelassene Teilnehmer können Kopien behalten. Arbeiten Sie lokal, wenn die Informationen diesen Browser nicht verlassen sollen.',
  'collaboration.title': 'Zusammenarbeit in Echtzeit',
  'collaboration.intro':
    'Arbeiten Sie gemeinsam an einem Diagramm. Der Eigentümer genehmigt jedes Gerät; die Inhalte werden zwischen den Teilnehmenden verschlüsselt.',
  'collaboration.unavailable':
    'Der Relay-Dienst ist nicht konfiguriert. Ihr lokaler Arbeitsbereich funktioniert wie gewohnt. Ein Administrator muss den Dienst konfigurieren, bevor Räume erstellt oder betreten werden können.',
  'collaboration.selectDiagram': 'Öffnen Sie ein Diagramm, bevor Sie einen Raum erstellen.',
  'collaboration.displayName': 'Ihr Anzeigename',
  'collaboration.nameHint':
    'Teilnehmende wählen ihre Namen selbst; es sind keine verifizierten Unternehmensidentitäten. Prüfen Sie den Gerätefingerabdruck über einen vertrauenswürdigen Kanal.',
  'collaboration.create': 'Raum erstellen',
  'collaboration.join': 'Raum beitreten',
  'collaboration.invitation': 'Privater Einladungslink',
  'collaboration.inviteHint':
    'Der Link ist geheim, nur einmal nutzbar und zeitlich begrenzt. Der Eigentümer muss das beitretende Gerät zusätzlich genehmigen.',
  'collaboration.coreScope':
    'Teilt Knoten, Verbindungen, Texte, Beschreibungen, Notizen, Simulationsmodell, Namen/Farben/Fotos der Teilnehmerprofile, Kommentare, Aufgaben und Aktivitäten dieses Diagramms. Andere Diagramme, Passwörter und Arbeitsbereichseinstellungen bleiben lokal.',
  'collaboration.scopeTitle': 'Zusätzliche Informationen einschließen',
  'collaboration.metadata': 'Eigene Metadaten und Integrations-IDs',
  'collaboration.owners': 'Zugewiesene Verantwortliche und ihre Angaben',
  'collaboration.datasets': 'Rohdatensätze und CSV-Analysedaten',
  'collaboration.shareConsent':
    'Ich habe das Diagramm geprüft und darf diese Informationen teilen.',
  'collaboration.createAction': 'Privaten Raum starten',
  'collaboration.joinAction': 'Beitritt anfragen',
  'collaboration.securityTitle': 'Bevor Sie teilen',
  'collaboration.securityBody':
    'Der Relay-Dienst sieht Verbindungs- und Mitgliedschaftsmetadaten, keine Diagramminhalte oder Schlüssel. Teilnehmende können Kopien behalten. Verschlüsselung schützt keinen entsperrten, kompromittierten Browser.',
  'collaboration.reloadWarning':
    'Die Schlüssel der Live-Sitzung bleiben im Arbeitsspeicher. Neuladen oder Sperren beendet Ihre lokale Sitzung. Eigentümer erstellen einen neuen Raum; andere Teilnehmende benötigen eine neue Einladung und Genehmigung.',
  'collaboration.backupWarning':
    'Das Entfernen einer Person oder Ändern eines Passworts kann bereits kopierte Screenshots, Exporte, Sicherungen und Informationen nicht zurückrufen.',
  'collaboration.joinWarning':
    'Prüfen Sie Einladung und Eigentümer über einen vertrauenswürdigen Kanal. Der Beitritt erstellt ein separates lokales Diagramm; Ihre anderen Diagramme werden nicht geteilt.',
  'collaboration.copy': 'Private Einladung kopieren',
  'collaboration.copied':
    'Einladung kopiert. Teilen Sie sie über einen privaten, vertrauenswürdigen Kanal.',
  'collaboration.copyFailed':
    'Der Browser konnte den Link nicht kopieren. Markieren und kopieren Sie ihn manuell.',
  'collaboration.newInvitation': 'Einmalige Einladung erstellen',
  'collaboration.expires': 'Gültig bis: {date}',
  'collaboration.participants': 'Teilnehmende im Raum',
  'collaboration.pending': 'Warten auf Ihre Genehmigung',
  'collaboration.fingerprint': 'Gerätefingerabdruck',
  'collaboration.compareFingerprint':
    'Vergleichen Sie vor der Genehmigung den vollständigen Fingerabdruck mit der Person über einen vertrauenswürdigen Kanal.',
  'collaboration.approve': 'Gerät genehmigen',
  'collaboration.reject': 'Anfrage ablehnen',
  'collaboration.role': 'Berechtigung',
  'collaboration.role.owner': 'Eigentümer',
  'collaboration.role.editor': 'Bearbeiter',
  'collaboration.role.viewer': 'Betrachter',
  'collaboration.roleHint':
    'Bearbeiter ändern das Diagramm. Betrachter lesen es. Nur der Eigentümer genehmigt Geräte und ändert Berechtigungen.',
  'collaboration.self': 'Sie',
  'collaboration.online': 'Verbunden',
  'collaboration.offline': 'Getrennt',
  'collaboration.selected': 'Ausgewählte Knoten: {count}',
  'collaboration.agent': 'MCP-Agent',
  'collaboration.remove': 'Person entfernen',
  'collaboration.leave': 'Raum verlassen',
  'collaboration.endLocalSession': 'Lokale Sitzung beenden',
  'collaboration.closeRoom': 'Raum für alle schließen',
  'collaboration.confirmTitle': 'Änderung im Raum bestätigen',
  'collaboration.confirmRemove':
    '{name} entfernen? Dieses Gerät verliert Zugriff auf zukünftige Nachrichten. Bereits erhaltene Kopien können nicht zurückgerufen werden.',
  'collaboration.confirmChangeRole':
    '{name} die Berechtigung {role} geben? Sie gilt für zukünftige Aktionen in diesem Raum.',
  'collaboration.confirmReject':
    'Die Geräteanfrage ablehnen? Für einen neuen Versuch wird eine neue Einladung benötigt.',
  'collaboration.confirmLeave':
    'Den Live-Raum verlassen? Ihr gespeichertes lokales Diagramm bleibt erhalten. Für die Rückkehr sind eine neue Einladung und Genehmigung nötig.',
  'collaboration.confirmEndLocalSession':
    'Die fehlgeschlagene Sitzung in diesem Browser beenden? Ihr gespeichertes lokales Diagramm bleibt erhalten. Der Raum im Relay-Dienst wird nicht geschlossen und andere Teilnehmende werden nicht getrennt. Erstellen Sie einen neuen Raum oder verwenden Sie eine neue Einladung, um wieder zusammenzuarbeiten.',
  'collaboration.confirmClose':
    'Den Raum für alle schließen? Alle werden getrennt. Gespeicherte lokale Diagramme und Kopien bleiben erhalten.',
  'collaboration.confirm': 'Änderung bestätigen',
  'collaboration.cancel': 'Abbrechen',
  'collaboration.busy': 'Wird bearbeitet…',
  'collaboration.reconnect': 'Live-Sitzung erneut verbinden',
  'collaboration.errorTitle': 'Zusammenarbeit erfordert Aufmerksamkeit',
  'collaboration.syncProgress': 'Synchronisierung: {completed} von {total} Teilen',
  'collaboration.status.idle': 'Lokaler Arbeitsbereich',
  'collaboration.status.connecting': 'Verbindung wird aufgebaut',
  'collaboration.status.awaiting-approval': 'Warten auf Genehmigung des Eigentümers',
  'collaboration.status.syncing': 'Diagramm wird synchronisiert',
  'collaboration.status.live': 'Live',
  'collaboration.status.offline': 'Offline · Live-Synchronisierung pausiert',
  'collaboration.status.conflict': 'Änderungen prüfen · Synchronisierung pausiert',
  'collaboration.status.error': 'Verbindung erfordert Aufmerksamkeit',
  'collaboration.sharing': 'In diesem Raum enthalten',
  'collaboration.room': 'Raum: {id}',
  'collaboration.ownerFingerprint': 'Gerätefingerabdruck des Eigentümers',
  'collaboration.selfFingerprint': 'Ihr Gerätefingerabdruck',
  'collaboration.selfFingerprintHint':
    'Teilen Sie dem Eigentümer vor der Freigabe den vollständigen Fingerabdruck über einen separaten vertrauenswürdigen Kanal mit.',
  'collaboration.recoveryCopy':
    'Ihre ungesendeten Änderungen wurden in einem lokalen Wiederherstellungsdiagramm gespeichert: „{name}“. Sie finden es unter {projects}. Das geteilte Diagramm entspricht jetzt der aktuellen Version des Eigentümers.',
  'collaboration.open': 'Zusammenarbeit und Teilnehmende öffnen',
  'collaboration.action': 'Zusammenarbeit',
  'collaboration.requiresEncryption':
    'Live-Zusammenarbeit erfordert den verschlüsselten App-Arbeitsbereich. Sie können Ihre lokalen Diagramme hier weiter bearbeiten. Das Öffnen der verschlüsselten App verschiebt oder teilt Ihre vorhandenen Diagramme nicht.',
  'collaboration.openEncryptedApp': 'Verschlüsselte App öffnen',
  'collaboration.connectedCount': '{count} verbunden',
  'collaboration.copyValue': '{label} kopieren',
  'collaboration.copyHint': 'Zum Kopieren anklicken oder antippen.',
  'collaboration.valueCopied': 'In die Zwischenablage kopiert.',
  'collaboration.valueCopyFailed':
    'Kopieren fehlgeschlagen. Den Wert auswählen und manuell kopieren.',
  'collaboration.deviceId': 'Geräte-ID',
  'collaboration.roomId': 'Raum-ID',
  'collaboration.document.profiles': 'Profile',
  'collaboration.document.comments': 'Kommentare',
  'collaboration.document.tasks': 'Aufgaben',
  'collaboration.document.activity': 'Aktivität',
  'collaboration.document.profileHint':
    'Gespeicherte Dokumentprofile haben frei gewählte Namen und Farben und sind von Geräten im Raum getrennt. Sie bestätigen keine Identität.',
  'collaboration.document.actingProfile': 'Aktives Dokumentprofil',
  'collaboration.document.chooseProfile':
    'Wählen Sie ein Dokumentprofil, bevor Sie Kommentare oder Aufgaben hinzufügen.',
  'collaboration.document.createProfile': 'Profil erstellen',
  'collaboration.document.profileName': 'Profilname',
  'collaboration.document.avatar': 'Profilbild',
  'collaboration.document.avatarHint':
    'PNG, JPEG oder WebP bis 8 MiB, 32 Megapixel und 16.384 Pixel pro Dimension. Gespeicherte Bilder werden auf höchstens 256 Pixel und 64 KiB verkleinert.',
  'collaboration.document.avatarError':
    'Wählen Sie ein gültiges PNG-, JPEG- oder WebP-Bild bis 8 MiB, 32 Megapixel und 16.384 Pixel pro Dimension.',
  'collaboration.document.removeAvatar': 'Profilbild entfernen',
  'collaboration.document.remove': 'Entfernen',
  'collaboration.document.confirmRemove': 'Entfernung bestätigen',
  'collaboration.document.removeHint':
    'Diesen gespeicherten Eintrag entfernen? Die Änderung wird mit den Teilnehmenden geteilt.',
  'collaboration.document.removeUnavailable':
    'Dieses Profil wird für die Dokumentarbeit verwendet oder ist das aktive Profil.',
  'collaboration.document.edit': 'Bearbeiten',
  'collaboration.document.commentText': 'Kommentartext',
  'collaboration.document.addComment': 'Kommentar hinzufügen',
  'collaboration.document.reply': 'Antworten',
  'collaboration.document.resolve': 'Thread abschließen',
  'collaboration.document.reopen': 'Thread wieder öffnen',
  'collaboration.document.resolved': 'Abgeschlossen',
  'collaboration.document.open': 'Offen',
  'collaboration.document.target': 'Verknüpfter Knoten',
  'collaboration.document.diagramTarget': 'Gesamtes Diagramm',
  'collaboration.document.chooseNode': 'Knoten wählen',
  'collaboration.document.missingNode': 'Knoten entfernt',
  'collaboration.document.taskTitle': 'Aufgabentitel',
  'collaboration.document.createTask': 'Aufgabe erstellen',
  'collaboration.document.assignee': 'Zugewiesenes Profil',
  'collaboration.document.unassigned': 'Nicht zugewiesen',
  'collaboration.document.taskStatus.todo': 'Zu erledigen',
  'collaboration.document.taskStatus.in-progress': 'In Arbeit',
  'collaboration.document.taskStatus.done': 'Erledigt',
  'collaboration.document.activityHint':
    'Der bearbeitbare Verlauf verwendet die Uhr des jeweiligen Verfassers. Ältere Einträge werden entfernt; dies ist kein Prüfprotokoll.',
  'collaboration.document.empty': 'Noch keine Einträge.',
  'collaboration.document.pages': 'Eintragsseiten',
  'collaboration.document.readOnly': 'Sie haben nur Lesezugriff auf diese Dokumentarbeit.',
  'collaboration.document.changeFailed': 'Die Änderung konnte nicht gespeichert werden.',
  'collaboration.document.event.created': 'Erstellt',
  'collaboration.document.event.updated': 'Aktualisiert',
  'collaboration.document.event.removed': 'Entfernt',
  'collaboration.document.event.replied': 'Antwort hinzugefügt',
  'collaboration.document.event.edited': 'Text bearbeitet',
  'collaboration.document.event.resolved': 'Abgeschlossen',
  'collaboration.document.event.reopened': 'Wieder geöffnet',
  'collaboration.document.source.ui': 'Editor',
  'collaboration.document.source.api': 'API',
  'collaboration.document.source.mcp': 'MCP',
  'collaboration.document.source.import': 'Import',
  'collaboration.document.source.collaboration': 'Live-Synchronisierung',
  'collaboration.roomTab': 'Live-Raum',
  'collaboration.documentTab': 'Dokumentarbeit',
  'collaboration.approvalProfile': 'Dokumentprofil',
  'collaboration.approvalNewProfileName': 'Neuer Profilname',
} satisfies CollaborationMessages;
export default messages;
