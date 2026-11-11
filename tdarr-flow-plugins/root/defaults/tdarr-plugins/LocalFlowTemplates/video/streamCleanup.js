'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Live Tdarr flow "Stream Cleanup" (original flow _id: StreamCleanup_PENDING), exported 2026-11-08, plus a Require English Audio check (id scRequireEng) and a Fail Flow node (id scFailNoEng) in front of Begin Command, and a Remove Untagged Audio step (id scRemoveUntagged) after Remove non-english audio. Bob added a Repair Language Tags node (id AmdPMw1wc, no inputs set, so the plugin defaults: language eng, encoder prefix Lavf, dryRun off) in the live flow on 2026-11-10: Require English Audio output 2 now goes to it instead of straight to Fail Flow; its output 1 (tags repaired) goes to Begin Command and its output 2 (nothing to repair) goes to Fail Flow. Node positions are the live ones. It only decides which streams stay (the command is run by the mkvmerge Execute node in the Clean and Converter flows); the old Remove title metadata and Set Container nodes are gone because mkvmerge removes the title and global tags and always writes mkv.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "StreamCleanup_PENDING",
    "name": "Stream Cleanup (0.6.0)",
    "description": "Stream Cleanup",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Entry from Clean or Converter Flow",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "scEntry",
        "position": {
          "x": 996,
          "y": -288
        }
      },
      {
        "name": "Require English Audio",
        "sourceRepo": "Local",
        "pluginName": "requireEnglishAudio",
        "version": "1.0.0",
        "fpEnabled": true,
        "inputsDB": {
          "languages": "eng,en"
        },
        "id": "scRequireEng",
        "position": {
          "x": 996,
          "y": -228
        }
      },
      {
        "name": "Fail Flow (no English audio)",
        "sourceRepo": "Community",
        "pluginName": "failFlow",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "scFailNoEng",
        "position": {
          "x": 1224,
          "y": -108
        }
      },
      {
        "name": "Begin Command",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandStart",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "scBegin",
        "position": {
          "x": 996,
          "y": -144
        }
      },
      {
        "name": "Remove images",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandRemoveStreamByProperty",
        "version": "1.0.0",
        "inputsDB": {
          "codecType": "any",
          "condition": "equals",
          "valuesToRemove": "attachment",
          "propertyToCheck": "codec_type"
        },
        "fpEnabled": true,
        "id": "scRemoveImages",
        "position": {
          "x": 996,
          "y": -96
        }
      },
      {
        "name": "Remove non-english audio",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandRemoveStreamByProperty",
        "version": "1.0.0",
        "inputsDB": {
          "codecType": "audio",
          "propertyToCheck": "tags.language",
          "valuesToRemove": "eng,en",
          "condition": "not_equals"
        },
        "fpEnabled": true,
        "id": "scRemoveAudio",
        "position": {
          "x": 996,
          "y": -48
        }
      },
      {
        "name": "Remove untagged audio",
        "sourceRepo": "Local",
        "pluginName": "removeUntaggedAudio",
        "version": "1.0.0",
        "fpEnabled": true,
        "inputsDB": {
          "languages": "eng,en"
        },
        "id": "scRemoveUntagged",
        "position": {
          "x": 996,
          "y": 0
        }
      },
      {
        "name": "Remove non-english subtitles",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandRemoveStreamByProperty",
        "version": "1.0.0",
        "inputsDB": {
          "codecType": "subtitle",
          "propertyToCheck": "tags.language",
          "valuesToRemove": "eng,en",
          "condition": "not_equals"
        },
        "fpEnabled": true,
        "id": "scRemoveSubs",
        "position": {
          "x": 996,
          "y": 36
        }
      },
      {
        "name": "🛫 Return to Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "HWxfel7zZ",
          "pluginId": "retFromCleanup"
        },
        "fpEnabled": true,
        "id": "scReturnToController",
        "position": {
          "x": 996,
          "y": 96
        }
      },
      {
        "name": "Repair Language Tags",
        "sourceRepo": "Local",
        "pluginName": "repairLanguageTags",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "AmdPMw1wc",
        "position": {
          "x": 1200,
          "y": -180
        }
      }
    ],
    "flowEdges": [
      {
        "source": "scEntry",
        "sourceHandle": "1",
        "target": "scRequireEng",
        "targetHandle": null,
        "id": "scE2"
      },
      {
        "source": "scRequireEng",
        "sourceHandle": "1",
        "target": "scBegin",
        "targetHandle": null,
        "id": "scE2b"
      },
      {
        "source": "scRequireEng",
        "sourceHandle": "2",
        "target": "AmdPMw1wc",
        "targetHandle": null,
        "id": "IK1yFZ3Bv"
      },
      {
        "source": "AmdPMw1wc",
        "sourceHandle": "1",
        "target": "scBegin",
        "targetHandle": null,
        "id": "X3RF1hLd7"
      },
      {
        "source": "AmdPMw1wc",
        "sourceHandle": "2",
        "target": "scFailNoEng",
        "targetHandle": null,
        "id": "29dayHdIw"
      },
      {
        "source": "scBegin",
        "sourceHandle": "1",
        "target": "scRemoveImages",
        "targetHandle": null,
        "id": "scE3"
      },
      {
        "source": "scRemoveImages",
        "sourceHandle": "1",
        "target": "scRemoveAudio",
        "targetHandle": null,
        "id": "scE4"
      },
      {
        "source": "scRemoveAudio",
        "sourceHandle": "1",
        "target": "scRemoveUntagged",
        "targetHandle": null,
        "id": "scE5"
      },
      {
        "source": "scRemoveUntagged",
        "sourceHandle": "1",
        "target": "scRemoveSubs",
        "targetHandle": null,
        "id": "scE5b"
      },
      {
        "source": "scRemoveSubs",
        "sourceHandle": "1",
        "target": "scReturnToController",
        "targetHandle": null,
        "id": "scE6"
      }
    ]
  });
exports.details = details;
