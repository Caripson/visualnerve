import type { CollaborationMessages } from './en';
const messages = {
  'collaboration.title': 'Reaaliaikainen yhteistyö',
  'collaboration.intro':
    'Työskentele yhdessä muiden kanssa samassa kaaviossa. Omistaja hyväksyy jokaisen laitteen; sisältö salataan osallistujien välillä.',
  'collaboration.unavailable':
    'Yhteistyön välityspalvelua ei ole määritetty. Paikallinen työtilasi toimii normaalisti. Ylläpitäjän on määritettävä palvelu ennen huoneiden luomista tai niihin liittymistä.',
  'collaboration.selectDiagram': 'Avaa kaavio ennen huoneen luomista.',
  'collaboration.displayName': 'Näyttönimesi',
  'collaboration.nameHint':
    'Osallistujat valitsevat nimensä itse; ne eivät ole vahvistettuja yritysidentiteettejä. Tarkista laitteen sormenjälki luotettavan kanavan kautta.',
  'collaboration.create': 'Luo huone',
  'collaboration.join': 'Liity huoneeseen',
  'collaboration.invitation': 'Yksityinen kutsulinkki',
  'collaboration.inviteHint':
    'Linkki on salainen, kertakäyttöinen ja määräaikainen. Omistajan on myös hyväksyttävä liittyvä laite.',
  'collaboration.coreScope':
    'Jakaa tämän kaavion solmut, yhteydet, tekstit, kuvaukset, muistiinpanot ja simulointimallin. Muut kaaviot, salasanat ja työtilan asetukset pysyvät paikallisina.',
  'collaboration.scopeTitle': 'Sisällytä lisätietoja',
  'collaboration.metadata': 'Omat metatiedot ja integraatiotunnisteet',
  'collaboration.owners': 'Määritetyt vastuuhenkilöt ja heidän tietonsa',
  'collaboration.datasets': 'Raaka-aineistot ja CSV-analyysitiedot',
  'collaboration.shareConsent': 'Olen tarkistanut kaavion ja saan jakaa nämä tiedot.',
  'collaboration.createAction': 'Aloita yksityinen huone',
  'collaboration.joinAction': 'Pyydä liittymistä',
  'collaboration.securityTitle': 'Ennen jakamista',
  'collaboration.securityBody':
    'Välityspalvelu näkee yhteys- ja jäsenyysmetatiedot, ei sisältöä tai salausavaimia. Osallistujat voivat säilyttää kopioita. Salaus ei suojaa avattua, vaarantunutta selainta.',
  'collaboration.reloadWarning':
    'Live-istunnon salausavaimet ovat vain muistissa. Uudelleenlataus tai lukitseminen päättää paikallisen istunnon. Omistaja luo uuden huoneen; muut osallistujat tarvitsevat uuden kutsun ja hyväksynnän.',
  'collaboration.backupWarning':
    'Osallistujan poistaminen tai salasanan vaihtaminen ei peruuta jo kopioituja kuvakaappauksia, vientejä, varmuuskopioita tai tietoja.',
  'collaboration.joinWarning':
    'Tarkista kutsu ja omistaja luotettavan kanavan kautta. Liittyminen luo erillisen paikallisen kaavion; muita kaavioitasi ei jaeta.',
  'collaboration.copy': 'Kopioi yksityinen kutsu',
  'collaboration.copied': 'Kutsu kopioitu. Jaa se yksityisen, luotettavan kanavan kautta.',
  'collaboration.copyFailed': 'Selain ei voinut kopioida linkkiä. Valitse ja kopioi se käsin.',
  'collaboration.newInvitation': 'Luo kertakäyttöinen kutsu',
  'collaboration.expires': 'Vanhenee: {date}',
  'collaboration.participants': 'Huoneen osallistujat',
  'collaboration.pending': 'Odottaa hyväksyntääsi',
  'collaboration.fingerprint': 'Laitteen sormenjälki',
  'collaboration.compareFingerprint':
    'Vertaa koko sormenjälkeä henkilön kanssa luotettavan kanavan kautta ennen hyväksymistä.',
  'collaboration.approve': 'Hyväksy laite',
  'collaboration.reject': 'Hylkää pyyntö',
  'collaboration.role': 'Käyttöoikeus',
  'collaboration.role.owner': 'Omistaja',
  'collaboration.role.editor': 'Muokkaaja',
  'collaboration.role.viewer': 'Katselija',
  'collaboration.roleHint':
    'Muokkaajat muuttavat kaaviota. Katselijat lukevat sitä. Vain omistaja hyväksyy laitteita ja muuttaa käyttöoikeuksia.',
  'collaboration.self': 'Sinä',
  'collaboration.online': 'Yhdistetty',
  'collaboration.offline': 'Yhteys katkaistu',
  'collaboration.selected': 'Valitut solmut: {count}',
  'collaboration.agent': 'MCP-agentti',
  'collaboration.remove': 'Poista osallistuja',
  'collaboration.leave': 'Poistu huoneesta',
  'collaboration.closeRoom': 'Sulje huone kaikilta',
  'collaboration.confirmTitle': 'Vahvista huoneen muutos',
  'collaboration.confirmRemove':
    'Poistetaanko {name}? Laite menettää pääsyn tuleviin viesteihin. Jo vastaanotettuja kopioita ei voi peruuttaa.',
  'collaboration.confirmChangeRole':
    'Vaihdetaanko käyttäjän {name} oikeudeksi {role}? Oikeus koskee huoneen tulevia toimintoja.',
  'collaboration.confirmReject': 'Hylätäänkö laitteen pyyntö? Uusi yritys vaatii uuden kutsun.',
  'collaboration.confirmLeave':
    'Poistutaanko live-huoneesta? Tallennettu paikallinen kaaviosi säilyy. Palaaminen vaatii uuden kutsun ja hyväksynnän.',
  'collaboration.confirmClose':
    'Suljetaanko huone kaikilta? Kaikkien osallistujien yhteys katkaistaan. Tallennetut paikalliset kaaviot ja kopiot säilyvät.',
  'collaboration.confirm': 'Vahvista muutos',
  'collaboration.cancel': 'Peruuta',
  'collaboration.busy': 'Käsitellään…',
  'collaboration.reconnect': 'Yhdistä live-istunto uudelleen',
  'collaboration.errorTitle': 'Yhteistyö vaatii huomiota',
  'collaboration.syncProgress': 'Synkronoidaan: {completed} / {total} osaa',
  'collaboration.status.idle': 'Paikallinen työtila',
  'collaboration.status.connecting': 'Yhdistetään',
  'collaboration.status.awaiting-approval': 'Odotetaan omistajan hyväksyntää',
  'collaboration.status.syncing': 'Synkronoidaan kaaviota',
  'collaboration.status.live': 'Live',
  'collaboration.status.offline': 'Ei yhteyttä · live-synkronointi keskeytetty',
  'collaboration.status.conflict': 'Muutokset tarkistettava · synkronointi keskeytetty',
  'collaboration.status.error': 'Yhteys vaatii huomiota',
  'collaboration.sharing': 'Sisältyy huoneeseen',
  'collaboration.room': 'Huone: {id}',
  'collaboration.ownerFingerprint': 'Omistajan laitteen sormenjälki',
  'collaboration.selfFingerprint': 'Laitteesi sormenjälki',
  'collaboration.selfFingerprintHint':
    'Jaa koko sormenjälki omistajalle erillisen luotetun kanavan kautta ennen hyväksyntää.',
  'collaboration.recoveryCopy':
    'Lähettämättömät muutoksesi tallennettiin paikalliseen palautuskaavioon: ”{name}”. Löydät sen kohdasta {projects}. Jaettu kaavio noudattaa nyt omistajan nykyistä versiota.',
  'collaboration.open': 'Avaa yhteistyö ja osallistujat',
  'collaboration.action': 'Yhteistyö',
  'collaboration.requiresEncryption':
    'Reaaliaikainen yhteistyö edellyttää salatun sovelluksen työtilaa. Voit jatkaa paikallisten kaavioiden muokkaamista täällä. Salatun sovelluksen avaaminen ei siirrä tai jaa nykyisiä kaavioitasi.',
  'collaboration.openEncryptedApp': 'Avaa salattu sovellus',
  'collaboration.connectedCount': '{count} yhdistetty',
  'collaboration.copyValue': 'Kopioi {label}',
  'collaboration.copyHint': 'Kopioi napsauttamalla tai napauttamalla.',
  'collaboration.valueCopied': 'Kopioitu leikepöydälle.',
  'collaboration.valueCopyFailed': 'Kopiointi epäonnistui. Valitse arvo ja kopioi se käsin.',
  'collaboration.deviceId': 'Laitetunnus',
  'collaboration.roomId': 'Huonetunnus',
} satisfies CollaborationMessages;
export default messages;
