//! Narrow application adapter for RFC 9420; cryptographic operations remain in OpenMLS.
//! The browser wrapper runs one instance in a disposable worker. Never send serialized
//! private state to the relay or document API. This adapter has not been independently audited.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::OpenMlsProvider;
use serde::{Deserialize as SerdeDeserialize, Serialize as SerdeSerialize};
use tls_codec::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use zeroize::Zeroize;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519;
const MAX_WIRE_BYTES: usize = 128 * 1024;
const MAX_MEMBERS: usize = 32;

#[derive(Clone, Debug, SerdeSerialize, SerdeDeserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceCredential {
    version: u8,
    device_id: String,
    transport_key_fingerprint: String,
}

impl DeviceCredential {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.device_id.len() < 8
            || self.device_id.len() > 128
            || !self
                .device_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
            || self.transport_key_fingerprint.len() != 64
            || !self
                .transport_key_fingerprint
                .bytes()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        {
            return Err("Invalid device credential".into());
        }
        Ok(())
    }
    fn from_credential(credential: &Credential) -> Result<Self, String> {
        let basic = BasicCredential::try_from(credential.clone())
            .map_err(|_| "Unsupported credential type")?;
        let value: Self =
            serde_json::from_slice(basic.identity()).map_err(|_| "Invalid device credential")?;
        value.validate()?;
        Ok(value)
    }
}

#[derive(SerdeSerialize)]
#[serde(rename_all = "camelCase")]
struct MemberInfo {
    device_id: String,
    transport_key_fingerprint: String,
    signature_public_key: String,
    leaf_index: u32,
}

#[derive(SerdeSerialize)]
#[serde(rename_all = "camelCase")]
struct GroupInfo {
    room_id: String,
    epoch: u64,
    active: bool,
    own_device_id: String,
    owner_device_id: String,
    members: Vec<MemberInfo>,
}

#[derive(SerdeSerialize)]
#[serde(rename_all = "camelCase")]
struct CommitInfo {
    commit: String,
    welcome: Option<String>,
    next_epoch: u64,
}

#[derive(SerdeSerialize)]
#[serde(rename_all = "camelCase")]
struct ProcessInfo {
    kind: String,
    sender_device_id: String,
    sender_signature_public_key: String,
    epoch: u64,
    payload: Option<String>,
    members: Option<Vec<MemberInfo>>,
}

struct Session {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: DeviceCredential,
    owner_device_id: String,
    group: Option<MlsGroup>,
}

impl Session {
    fn new(device_id: String, fingerprint: String) -> Result<Self, String> {
        let credential = DeviceCredential {
            version: 1,
            device_id,
            transport_key_fingerprint: fingerprint,
        };
        credential.validate()?;
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|_| "Identity creation failed")?;
        signer
            .store(provider.storage())
            .map_err(|_| "Identity storage failed")?;
        Ok(Self {
            provider,
            signer,
            credential,
            owner_device_id: String::new(),
            group: None,
        })
    }
    fn credential_with_key(&self) -> Result<CredentialWithKey, String> {
        let identity =
            serde_json::to_vec(&self.credential).map_err(|_| "Credential encoding failed")?;
        Ok(CredentialWithKey {
            credential: BasicCredential::new(identity).into(),
            signature_key: self.signer.public().into(),
        })
    }
    fn key_package(&self) -> Result<Vec<u8>, String> {
        let package = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential_with_key()?,
            )
            .map_err(|_| "Key package creation failed")?;
        package
            .key_package()
            .tls_serialize_detached()
            .map_err(|_| "Key package encoding failed".into())
    }
    fn create_group(&mut self, room_id: &str) -> Result<(), String> {
        validate_room_id(room_id)?;
        if self.group.is_some() {
            return Err("Session already has a group".into());
        }
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .max_past_epochs(0)
            .build();
        let group = MlsGroup::new_with_group_id(
            &self.provider,
            &self.signer,
            &config,
            GroupId::from_slice(room_id.as_bytes()),
            self.credential_with_key()?,
        )
        .map_err(|_| "Group creation failed")?;
        self.owner_device_id = self.credential.device_id.clone();
        self.group = Some(group);
        Ok(())
    }
    fn join(
        &mut self,
        bytes: &[u8],
        room_id: &str,
        owner_device_id: &str,
        owner_signature_key: &[u8],
    ) -> Result<(), String> {
        validate_room_id(room_id)?;
        if self.group.is_some() {
            return Err("Session already has a group".into());
        }
        let message = parse_message(bytes)?;
        let welcome = match message.extract() {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => return Err("Expected MLS welcome".into()),
        };
        let config = MlsGroupJoinConfig::builder().max_past_epochs(0).build();
        let staged = StagedWelcome::new_from_welcome(&self.provider, &config, welcome, None)
            .map_err(|_| "Welcome verification failed")?;
        let members = staged.members().collect::<Vec<_>>();
        let owner = members
            .iter()
            .find(|m| {
                DeviceCredential::from_credential(&m.credential)
                    .is_ok_and(|c| c.device_id == owner_device_id)
            })
            .ok_or("Pinned owner missing")?;
        if owner.signature_key != owner_signature_key {
            return Err("Owner signing key changed".into());
        }
        validate_members(
            members
                .iter()
                .map(|m| (&m.credential, m.signature_key.as_slice())),
        )?;
        let group = staged
            .into_group(&self.provider)
            .map_err(|_| "Group join failed")?;
        if group.group_id().as_slice() != room_id.as_bytes() {
            return Err("Welcome room mismatch".into());
        }
        self.owner_device_id = owner_device_id.to_owned();
        self.group = Some(group);
        Ok(())
    }
    fn members(&self) -> Result<Vec<MemberInfo>, String> {
        let group = self.group.as_ref().ok_or("No group")?;
        group
            .members()
            .map(|m| {
                let credential = DeviceCredential::from_credential(&m.credential)?;
                Ok(MemberInfo {
                    device_id: credential.device_id,
                    transport_key_fingerprint: credential.transport_key_fingerprint,
                    signature_public_key: URL_SAFE_NO_PAD.encode(m.signature_key),
                    leaf_index: m.index.u32(),
                })
            })
            .collect()
    }
    fn group_info(&self) -> Result<GroupInfo, String> {
        let group = self.group.as_ref().ok_or("No group")?;
        Ok(GroupInfo {
            room_id: String::from_utf8(group.group_id().as_slice().to_vec())
                .map_err(|_| "Invalid room ID")?,
            epoch: group.epoch().as_u64(),
            active: group.is_active(),
            own_device_id: self.credential.device_id.clone(),
            owner_device_id: self.owner_device_id.clone(),
            members: self.members()?,
        })
    }
    fn add(
        &mut self,
        bytes: &[u8],
        device_id: &str,
        fingerprint: &str,
        expected_signature_key: &[u8],
    ) -> Result<CommitInfo, String> {
        self.assert_owner()?;
        let mut input = bytes;
        if input.len() > 32 * 1024 {
            return Err("Key package too large".into());
        }
        let package =
            KeyPackageIn::tls_deserialize(&mut input).map_err(|_| "Invalid key package")?;
        if !input.is_empty() {
            return Err("Trailing key package bytes".into());
        }
        let package = package
            .validate(self.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(|_| "Key package verification failed")?;
        let credential = DeviceCredential::from_credential(package.leaf_node().credential())?;
        if credential.device_id != device_id || credential.transport_key_fingerprint != fingerprint
        {
            return Err("Key package identity mismatch".into());
        }
        if expected_signature_key.len() != 32
            || package.leaf_node().signature_key().as_slice() != expected_signature_key
        {
            // Admission is checked before producing a pending commit. A malicious
            // relay must not poison the room by substituting an MLS signing key.
            return Err("Key package signing key mismatch".into());
        }
        let group = self.group.as_mut().ok_or("No group")?;
        if group.members().count() >= MAX_MEMBERS {
            return Err("Room member limit reached".into());
        }
        if group.members().any(|m| {
            DeviceCredential::from_credential(&m.credential).is_ok_and(|c| c.device_id == device_id)
        }) {
            return Err("Device already in group".into());
        }
        let (commit, welcome, _) = group
            .add_members(&self.provider, &self.signer, &[package])
            .map_err(|_| "Member add failed")?;
        Ok(CommitInfo {
            commit: URL_SAFE_NO_PAD.encode(encode_message(&commit)?),
            welcome: Some(URL_SAFE_NO_PAD.encode(encode_message(&welcome)?)),
            next_epoch: group.epoch().as_u64() + 1,
        })
    }
    fn remove(&mut self, device_id: &str) -> Result<CommitInfo, String> {
        self.assert_owner()?;
        if device_id == self.owner_device_id {
            return Err("Owner cannot be removed".into());
        }
        let group = self.group.as_mut().ok_or("No group")?;
        let member = group
            .members()
            .find(|m| {
                DeviceCredential::from_credential(&m.credential)
                    .is_ok_and(|c| c.device_id == device_id)
            })
            .ok_or("Unknown member")?;
        let (commit, _, _) = group
            .remove_members(&self.provider, &self.signer, &[member.index])
            .map_err(|_| "Member removal failed")?;
        Ok(CommitInfo {
            commit: URL_SAFE_NO_PAD.encode(encode_message(&commit)?),
            welcome: None,
            next_epoch: group.epoch().as_u64() + 1,
        })
    }
    fn rotate(&mut self) -> Result<CommitInfo, String> {
        self.assert_owner()?;
        let group = self.group.as_mut().ok_or("No group")?;
        let bundle = group
            .self_update(&self.provider, &self.signer, LeafNodeParameters::default())
            .map_err(|_| "Key rotation failed")?;
        Ok(CommitInfo {
            commit: URL_SAFE_NO_PAD.encode(encode_message(bundle.commit())?),
            welcome: None,
            next_epoch: group.epoch().as_u64() + 1,
        })
    }
    fn merge_pending(&mut self) -> Result<(), String> {
        self.group
            .as_mut()
            .ok_or("No group")?
            .merge_pending_commit(&self.provider)
            .map_err(|_| "Commit merge failed".into())
    }
    fn discard_pending(&mut self) -> Result<(), String> {
        self.group
            .as_mut()
            .ok_or("No group")?
            .clear_pending_commit(self.provider.storage())
            .map_err(|_| "Commit discard failed".into())
    }
    fn encrypt(&mut self, payload: &[u8]) -> Result<Vec<u8>, String> {
        if payload.len() > MAX_WIRE_BYTES / 2 {
            return Err("Payload too large".into());
        }
        let message = self
            .group
            .as_mut()
            .ok_or("No group")?
            .create_message(&self.provider, &self.signer, payload)
            .map_err(|_| "Message encryption failed")?;
        encode_message(&message)
    }
    fn process(&mut self, bytes: &[u8], expected_device_id: &str) -> Result<ProcessInfo, String> {
        let message = parse_message(bytes)?
            .try_into_protocol_message()
            .map_err(|_| "Expected MLS protocol message")?;
        let group = self.group.as_mut().ok_or("No group")?;
        let processed = group
            .process_message(&self.provider, message)
            .map_err(|_| "Message authentication failed")?;
        let credential = DeviceCredential::from_credential(processed.credential())?;
        if credential.device_id != expected_device_id {
            return Err("Authenticated sender mismatch".into());
        }
        let signature_key = match processed.sender() {
            Sender::Member(index) => {
                group
                    .member_at(*index)
                    .ok_or("Unknown sender")?
                    .signature_key
            }
            _ => return Err("External senders are not permitted".into()),
        };
        let epoch = group.epoch().as_u64();
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(payload) => Ok(ProcessInfo {
                kind: "application".into(),
                sender_device_id: credential.device_id,
                sender_signature_public_key: URL_SAFE_NO_PAD.encode(signature_key),
                epoch,
                payload: Some(URL_SAFE_NO_PAD.encode(payload.into_bytes())),
                members: None,
            }),
            ProcessedMessageContent::StagedCommitMessage(staged) => {
                if credential.device_id != self.owner_device_id {
                    return Err("Only owner commits are permitted".into());
                }
                // This first live collaboration protocol supports owner-authored
                // inline Add/Remove commits and empty self-updates only. Do not
                // silently accept credential changes, PSKs, external joins, reinit
                // or extensions merely because the MLS message is well formed.
                if staged.queued_proposals().any(|queued| {
                    !matches!(queued.proposal(), Proposal::Add(_) | Proposal::Remove(_))
                }) {
                    return Err("Unsupported membership proposal".into());
                }
                // Validate the projected membership before accepting the commit.
                let removed = staged
                    .remove_proposals()
                    .map(|p| p.remove_proposal().removed())
                    .collect::<Vec<_>>();
                let mut projected = group
                    .members()
                    .filter(|m| !removed.contains(&m.index))
                    .map(|m| (m.credential, m.signature_key))
                    .collect::<Vec<_>>();
                for added in staged.add_proposals() {
                    let leaf = added.add_proposal().key_package().leaf_node();
                    projected.push((
                        leaf.credential().clone(),
                        leaf.signature_key().as_slice().to_vec(),
                    ));
                }
                validate_members(projected.iter().map(|(c, k)| (c, k.as_slice())))?;
                if !projected.iter().any(|(c, k)| {
                    DeviceCredential::from_credential(c)
                        .is_ok_and(|d| d.device_id == self.owner_device_id)
                        && k.as_slice() == signature_key.as_slice()
                }) {
                    return Err("Pinned owner cannot change identity".into());
                }
                if let Some(leaf) = staged.update_path_leaf_node() {
                    if DeviceCredential::from_credential(leaf.credential())? != credential
                        || leaf.signature_key().as_slice() != signature_key.as_slice()
                    {
                        return Err("Owner credential change is not supported".into());
                    }
                }
                group
                    .merge_staged_commit(&self.provider, *staged)
                    .map_err(|_| "Commit merge failed")?;
                Ok(ProcessInfo {
                    kind: "commit".into(),
                    sender_device_id: credential.device_id,
                    sender_signature_public_key: URL_SAFE_NO_PAD.encode(signature_key),
                    epoch: group.epoch().as_u64(),
                    payload: None,
                    members: Some(self.members()?),
                })
            }
            _ => Err("Standalone proposals and external joins are not supported".into()),
        }
    }
    fn assert_owner(&self) -> Result<(), String> {
        if self.credential.device_id != self.owner_device_id {
            Err("Only owner can change membership".into())
        } else {
            Ok(())
        }
    }
    fn close(&mut self) {
        self.group = None;
        if let Ok(mut values) = self.provider.storage().values.write() {
            for (mut key, mut value) in values.drain() {
                key.zeroize();
                value.zeroize();
            }
        }
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}
fn validate_room_id(room_id: &str) -> Result<(), String> {
    if room_id.is_empty()
        || room_id.len() > 128
        || !room_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
    {
        Err("Invalid room ID".into())
    } else {
        Ok(())
    }
}
fn validate_members<'a>(
    members: impl Iterator<Item = (&'a Credential, &'a [u8])>,
) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    let mut keys = std::collections::HashSet::new();
    for (credential, key) in members {
        let credential = DeviceCredential::from_credential(credential)?;
        if !ids.insert(credential.device_id) || !keys.insert(key.to_vec()) {
            return Err("Duplicate device credential".into());
        }
    }
    if ids.len() > MAX_MEMBERS {
        return Err("Room member limit reached".into());
    }
    Ok(())
}
fn parse_message(bytes: &[u8]) -> Result<MlsMessageIn, String> {
    if bytes.is_empty() || bytes.len() > MAX_WIRE_BYTES {
        return Err("Invalid message size".into());
    }
    let mut input = bytes;
    let message = MlsMessageIn::tls_deserialize(&mut input).map_err(|_| "Invalid MLS message")?;
    if !input.is_empty() {
        return Err("Trailing message bytes".into());
    }
    Ok(message)
}
fn encode_message(message: &MlsMessageOut) -> Result<Vec<u8>, String> {
    message
        .tls_serialize_detached()
        .map_err(|_| "Message encoding failed".into())
}
fn encode_json(value: &impl SerdeSerialize) -> Result<String, JsError> {
    serde_json::to_string(value).map_err(|_| JsError::new("Encoding failed"))
}
fn js_error(error: String) -> JsError {
    JsError::new(&error)
}

#[wasm_bindgen]
pub struct MlsCryptoSession {
    inner: Option<Session>,
}
#[wasm_bindgen]
impl MlsCryptoSession {
    #[wasm_bindgen(constructor)]
    pub fn new(
        device_id: String,
        transport_key_fingerprint: String,
    ) -> Result<MlsCryptoSession, JsError> {
        Ok(Self {
            inner: Some(Session::new(device_id, transport_key_fingerprint).map_err(js_error)?),
        })
    }
    pub fn key_package(&self) -> Result<Vec<u8>, JsError> {
        self.session()?.key_package().map_err(js_error)
    }
    pub fn signature_public_key(&self) -> Result<Vec<u8>, JsError> {
        Ok(self.session()?.signer.public().to_vec())
    }
    pub fn create_group(&mut self, room_id: &str) -> Result<(), JsError> {
        self.session_mut()?.create_group(room_id).map_err(js_error)
    }
    pub fn join(
        &mut self,
        welcome: &[u8],
        room_id: &str,
        owner_device_id: &str,
        owner_signature_key: &[u8],
    ) -> Result<(), JsError> {
        self.session_mut()?
            .join(welcome, room_id, owner_device_id, owner_signature_key)
            .map_err(js_error)
    }
    pub fn info(&self) -> Result<String, JsError> {
        encode_json(&self.session()?.group_info().map_err(js_error)?)
    }
    pub fn add_member(
        &mut self,
        key_package: &[u8],
        device_id: &str,
        fingerprint: &str,
        expected_signature_key: &[u8],
    ) -> Result<String, JsError> {
        encode_json(
            &self
                .session_mut()?
                .add(key_package, device_id, fingerprint, expected_signature_key)
                .map_err(js_error)?,
        )
    }
    pub fn remove_member(&mut self, device_id: &str) -> Result<String, JsError> {
        encode_json(&self.session_mut()?.remove(device_id).map_err(js_error)?)
    }
    pub fn rotate(&mut self) -> Result<String, JsError> {
        encode_json(&self.session_mut()?.rotate().map_err(js_error)?)
    }
    pub fn merge_pending_commit(&mut self) -> Result<(), JsError> {
        self.session_mut()?.merge_pending().map_err(js_error)
    }
    pub fn discard_pending_commit(&mut self) -> Result<(), JsError> {
        self.session_mut()?.discard_pending().map_err(js_error)
    }
    pub fn encrypt(&mut self, payload: &[u8]) -> Result<Vec<u8>, JsError> {
        self.session_mut()?.encrypt(payload).map_err(js_error)
    }
    pub fn process(&mut self, message: &[u8], expected_device_id: &str) -> Result<String, JsError> {
        encode_json(
            &self
                .session_mut()?
                .process(message, expected_device_id)
                .map_err(js_error)?,
        )
    }
    pub fn close(&mut self) {
        self.inner = None;
    }
}
impl MlsCryptoSession {
    fn session(&self) -> Result<&Session, JsError> {
        self.inner
            .as_ref()
            .ok_or_else(|| JsError::new("Session closed"))
    }
    fn session_mut(&mut self) -> Result<&mut Session, JsError> {
        self.inner
            .as_mut()
            .ok_or_else(|| JsError::new("Session closed"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn participant(device: &str, letter: &str) -> Session {
        Session::new(device.into(), letter.repeat(64)).unwrap()
    }
    fn pair() -> (Session, Session) {
        let mut owner = participant("owner-device", "a");
        let mut editor = participant("editor-device", "b");
        owner.create_group("room-test").unwrap();
        let welcome = owner
            .add(
                &editor.key_package().unwrap(),
                "editor-device",
                &"b".repeat(64),
                editor.signer.public(),
            )
            .unwrap();
        owner.merge_pending().unwrap();
        editor
            .join(
                &URL_SAFE_NO_PAD.decode(welcome.welcome.unwrap()).unwrap(),
                "room-test",
                "owner-device",
                owner.signer.public(),
            )
            .unwrap();
        (owner, editor)
    }
    #[test]
    fn authenticates_and_decrypts_bidirectional_messages() {
        let (mut owner, mut editor) = pair();
        let message = owner.encrypt(b"private node text").unwrap();
        assert!(!message.windows(17).any(|s| s == b"private node text"));
        let result = editor.process(&message, "owner-device").unwrap();
        assert_eq!(
            URL_SAFE_NO_PAD.decode(result.payload.unwrap()).unwrap(),
            b"private node text"
        );
        assert_eq!(result.sender_device_id, "owner-device");
        let response = editor.encrypt(b"reply").unwrap();
        assert_eq!(
            owner
                .process(&response, "editor-device")
                .unwrap()
                .sender_device_id,
            "editor-device"
        );
    }
    #[test]
    fn rejects_replayed_generations() {
        let (mut owner, mut editor) = pair();
        let message = owner.encrypt(b"one change").unwrap();
        editor.process(&message, "owner-device").unwrap();
        assert!(editor.process(&message, "owner-device").is_err());
    }
    #[test]
    fn rejects_tampered_ciphertext_and_wrong_author() {
        let (mut owner, mut editor) = pair();
        let message = owner.encrypt(b"first").unwrap();
        let mut corrupted = message.clone();
        let last = corrupted.len() - 1;
        corrupted[last] ^= 1;
        assert!(editor.process(&corrupted, "owner-device").is_err());
        let second = owner.encrypt(b"second").unwrap();
        assert!(editor.process(&second, "editor-device").is_err());
    }
    #[test]
    fn welcome_pins_room_and_owner_signing_key() {
        let mut owner = participant("owner-device", "a");
        let recipient = participant("new-device", "b");
        owner.create_group("room-test").unwrap();
        let add = owner
            .add(
                &recipient.key_package().unwrap(),
                "new-device",
                &"b".repeat(64),
                recipient.signer.public(),
            )
            .unwrap();
        let welcome = URL_SAFE_NO_PAD.decode(add.welcome.unwrap()).unwrap();
        let mut recipient = recipient;
        assert!(recipient
            .join(
                &welcome,
                "different-room",
                "owner-device",
                owner.signer.public()
            )
            .is_err());
        let mut owner = participant("owner-device", "a");
        let mut recipient = participant("new-device", "b");
        owner.create_group("room-next").unwrap();
        let add = owner
            .add(
                &recipient.key_package().unwrap(),
                "new-device",
                &"b".repeat(64),
                recipient.signer.public(),
            )
            .unwrap();
        assert!(recipient
            .join(
                &URL_SAFE_NO_PAD.decode(add.welcome.unwrap()).unwrap(),
                "room-next",
                "owner-device",
                &[0; 32]
            )
            .is_err());
    }
    #[test]
    fn verifies_key_package_transport_binding_and_duplicate_devices() {
        let (mut owner, _) = pair();
        let stranger = participant("guest-device", "c");
        let package = stranger.key_package().unwrap();
        assert!(owner
            .add(
                &package,
                "other-device",
                &"c".repeat(64),
                stranger.signer.public()
            )
            .is_err());
        assert!(owner
            .add(
                &package,
                "guest-device",
                &"d".repeat(64),
                stranger.signer.public()
            )
            .is_err());
        let duplicate = participant("editor-device", "e");
        assert!(owner
            .add(
                &duplicate.key_package().unwrap(),
                "editor-device",
                &"e".repeat(64),
                duplicate.signer.public()
            )
            .is_err());
    }
    #[test]
    fn removed_member_cannot_decrypt_future_epoch() {
        let (mut owner, mut editor) = pair();
        let old = owner.encrypt(b"old epoch").unwrap();
        editor.process(&old, "owner-device").unwrap();
        let removal = owner.remove("editor-device").unwrap();
        owner.merge_pending().unwrap();
        let future = owner.encrypt(b"future secret").unwrap();
        assert!(editor.process(&future, "owner-device").is_err());
        editor
            .process(
                &URL_SAFE_NO_PAD.decode(removal.commit).unwrap(),
                "owner-device",
            )
            .unwrap();
        assert!(!editor.group_info().unwrap().active);
        assert!(editor.encrypt(b"write after removal").is_err());
        assert!(editor.process(&future, "owner-device").is_err());
        assert_eq!(owner.group_info().unwrap().epoch, 2);
    }
    #[test]
    fn membership_commands_are_owner_only() {
        let (mut owner, mut editor) = pair();
        assert!(editor.remove("owner-device").is_err());
        assert!(owner.remove("owner-device").is_err());
        let stranger = participant("guest-device", "c");
        assert!(editor
            .add(
                &stranger.key_package().unwrap(),
                "guest-device",
                &"c".repeat(64),
                stranger.signer.public()
            )
            .is_err());
        // Even a malicious client bypassing our sender-side guard cannot make another
        // recipient accept a member-authored membership commit.
        let package =
            KeyPackageIn::tls_deserialize(&mut stranger.key_package().unwrap().as_slice())
                .unwrap()
                .validate(editor.provider.crypto(), ProtocolVersion::Mls10)
                .unwrap();
        let (commit, _, _) = editor
            .group
            .as_mut()
            .unwrap()
            .add_members(&editor.provider, &editor.signer, &[package])
            .unwrap();
        assert!(owner
            .process(&encode_message(&commit).unwrap(), "editor-device")
            .is_err());
        assert_eq!(owner.members().unwrap().len(), 2);
        assert_eq!(owner.group_info().unwrap().epoch, 1);
    }
    #[test]
    fn invalid_inputs_are_errors_and_do_not_panic() {
        let (mut owner, _) = pair();
        for bytes in [&[][..], &[1, 2, 3][..], &[255; 200][..]] {
            assert!(owner.process(bytes, "editor-device").is_err());
            assert!(owner
                .add(bytes, "guest-device", &"c".repeat(64), &[0; 32])
                .is_err());
        }
        let message = owner.encrypt(b"payload").unwrap();
        let mut trailing = message;
        trailing.push(0);
        assert!(parse_message(&trailing).is_err());
    }
    #[test]
    fn transport_credentials_validate_shape() {
        assert!(Session::new("short".into(), "a".repeat(64)).is_err());
        assert!(Session::new("valid-device".into(), "A".repeat(64)).is_err());
        assert!(Session::new("valid-device".into(), "z".repeat(64)).is_err());
        assert!(Session::new("valid.device".into(), "a".repeat(64)).is_err());
    }
    #[test]
    fn pending_commit_only_becomes_live_after_ack() {
        let (mut owner, _) = pair();
        owner.remove("editor-device").unwrap();
        assert_eq!(owner.group_info().unwrap().epoch, 1);
        owner.discard_pending().unwrap();
        assert_eq!(owner.members().unwrap().len(), 2);
        assert_eq!(owner.group_info().unwrap().epoch, 1);
    }
    #[test]
    fn independent_rooms_do_not_decrypt_each_other() {
        let (mut owner, _) = pair();
        let (mut other, mut recipient) = pair();
        let message = owner.encrypt(b"room A").unwrap();
        assert!(recipient.process(&message, "owner-device").is_err());
        let own_message = other.encrypt(b"room B").unwrap();
        assert!(recipient.process(&own_message, "owner-device").is_ok());
    }
    #[test]
    fn closing_clears_the_provider_secret_store() {
        let (mut owner, _) = pair();
        assert!(!owner.provider.storage().values.read().unwrap().is_empty());
        owner.close();
        assert!(owner.provider.storage().values.read().unwrap().is_empty());
        assert!(owner.encrypt(b"closed").is_err());
    }
    #[test]
    fn sender_generations_support_bounded_reordering_without_replay() {
        let (mut owner, mut editor) = pair();
        let first = owner.encrypt(b"first").unwrap();
        let second = owner.encrypt(b"second").unwrap();
        assert_ne!(first, second);
        editor.process(&second, "owner-device").unwrap();
        editor.process(&first, "owner-device").unwrap();
        assert!(editor.process(&first, "owner-device").is_err());
    }
    #[test]
    fn old_epochs_are_not_retained_after_rotation() {
        let (mut owner, mut editor) = pair();
        let previous = owner.encrypt(b"old epoch delayed").unwrap();
        let rotate = owner.rotate().unwrap();
        owner.merge_pending().unwrap();
        editor
            .process(
                &URL_SAFE_NO_PAD.decode(rotate.commit).unwrap(),
                "owner-device",
            )
            .unwrap();
        assert!(editor.process(&previous, "owner-device").is_err());
        let new = owner.encrypt(b"new epoch").unwrap();
        assert!(editor.process(&new, "owner-device").is_ok());
    }
    #[test]
    fn repeated_epoch_changes_keep_single_client_provider_consistent() {
        let (mut owner, mut editor) = pair();
        for epoch in 2..=20 {
            let rotate = owner.rotate().unwrap();
            owner.merge_pending().unwrap();
            editor
                .process(
                    &URL_SAFE_NO_PAD.decode(rotate.commit).unwrap(),
                    "owner-device",
                )
                .unwrap();
            assert_eq!(owner.group_info().unwrap().epoch, epoch);
            assert_eq!(editor.group_info().unwrap().epoch, epoch);
            let message = editor.encrypt(b"still connected").unwrap();
            assert!(owner.process(&message, "editor-device").is_ok());
        }
    }
    #[test]
    fn trailing_key_package_input_is_never_accepted() {
        let (mut owner, _) = pair();
        let guest = participant("guest-device", "c");
        let mut key_package = guest.key_package().unwrap();
        key_package.push(0);
        assert!(owner
            .add(
                &key_package,
                "guest-device",
                &"c".repeat(64),
                guest.signer.public()
            )
            .is_err());
    }
    #[test]
    fn substituted_admission_signing_key_is_rejected_before_pending_commit() {
        let (mut owner, _) = pair();
        let guest = participant("guest-device", "c");
        let package = guest.key_package().unwrap();
        assert!(owner
            .add(&package, "guest-device", &"c".repeat(64), &[0; 32])
            .is_err());
        assert!(owner
            .add(&package, "guest-device", &"c".repeat(64), &[])
            .is_err());
        assert_eq!(owner.group_info().unwrap().epoch, 1);
        assert_eq!(owner.members().unwrap().len(), 2);
        // Failed validation must not leave a pending commit or block a correct admission.
        let accepted = owner
            .add(
                &package,
                "guest-device",
                &"c".repeat(64),
                guest.signer.public(),
            )
            .unwrap();
        assert_eq!(accepted.next_epoch, 2);
        owner.merge_pending().unwrap();
        assert_eq!(owner.members().unwrap().len(), 3);
    }
}
