'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "Controller" (originally _id WReQY_XGS, now HWxfel7zZ) on 2026-11-08, and
// brought up to the live "Controller (0.6.0)" on 2026-11-10 (the build stamps the template's version onto the name, so the name here stays plain). Changes from that update: the "Route to local CPU" and "Mark step: landed on local" nodes are gone, Input File
// leads through "Mark step: controller start" straight into Run Health Check, and three node positions moved.
// Brought up to the live "Controller (v10)" on 2026-11-11: new "Queue to mapped nodes" (Tags: Worker Type, CPU worker on a node tagged mapped) between Input File and
// "Mark step: controller start". An unmapped encoder node that picks the job up at Input File re-queues it to a mapped node there, and its job log says it did
// not download the file ("unmapped node, tags plugin after start plugin, no need to download file"). Three node positions moved.
// Quality tier, 2026-11-12: new "Set Encode Quality" between Check Source Efficiency output 1 and Go To Converter Flow. It sets the Flow Variable tdarrQuality (the baseline quality
// number: 18, or 31 for a source above 30 fps) and the Converter's "Set Quality With Node Offset" adds the encode node's offset to it. The Check Force Reencode path to the Converter is unchanged
// (no tdarrQuality there, so the Converter keeps the quality its Set Video Encoder node writes, plus the node offset).
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
// Synced to Bob's live "Controller (v12)" on 2026-11-15: Set Encode Quality is gone (Check Source Efficiency output 1 now goes straight to Go To Converter Flow), "Queue to mapped nodes" is now "Queue to local node" with node tags mapped,local, and three nodes moved.
// Demux restructure, 2026-11-16: the Clean-only Passthrough flow is retired. Every route that went to Go To Clean Flow (sources that are not re-encoded) now goes straight to Go To Validator Flow (passthrough); Stream Cleanup has already split the file, and the Validator's mkvmerge combine puts it back together. "Go To Clean Flow" and "Returned from Clean Flow" are gone.
// Stream Cleanup merged into the Controller, 2026-11-19, from Bob's live "Controller (v13)" and "Stream Cleanup (v8)": there is no separate Stream Cleanup flow any more. After "Mark step: quick health check done" the job goes straight through Require English Audio (output 2, no English tag: Repair Language Tags, whose output 2 goes to Fail Flow (no English audio)), Begin Command, Remove images, Remove non-english audio, Remove untagged audio, Remove non-english subtitles and Split Streams (ffmpeg), and then into Classify Source. "Go To Stream Cleanup Flow", "Returned from Stream Cleanup Flow", the Stream Cleanup flow's own Entry and "Return to Controller Flow" nodes are gone; every other node, edge and setting is the live Controller (v13) as it is (Bob's live v13 has no "Returned from Converter Flow" / "Go To Validator Flow" pair, which the previous template still had). Node positions: the nine Stream Cleanup nodes sit in the Controller's left column under the health check and to its left.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "HWxfel7zZ",
    "name": "Controller",
    "description": "Controller",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Input File",
        "sourceRepo": "Community",
        "pluginName": "inputFile",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "6sLbd7Q3m",
        "position": {
          "x": 612,
          "y": -312
        }
      },
      {
        "name": "Run Health Check",
        "sourceRepo": "Community",
        "pluginName": "runHealthCheck",
        "version": "1.0.0",
        "inputsDB": {
          "gpuAcceleration": "qsv"
        },
        "fpEnabled": true,
        "id": "Pu7lH9MsN",
        "position": {
          "x": 612,
          "y": -204
        }
      },
      {
        "name": "Classify Source",
        "sourceRepo": "Local",
        "pluginName": "classifySource",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "classifySrc",
        "position": {
          "x": 948,
          "y": -240
        }
      },
      {
        "name": "Check Force Reencode",
        "sourceRepo": "Community",
        "pluginName": "checkFlowVariable",
        "version": "1.0.0",
        "inputsDB": {
          "variable": "{{{args.userVariables.library.forceReencode}}}",
          "condition": "==",
          "value": "true"
        },
        "fpEnabled": true,
        "id": "chkForceReencode",
        "position": {
          "x": 1152,
          "y": -132
        }
      },
      {
        "name": "Check Source Efficiency",
        "sourceRepo": "Local",
        "pluginName": "checkSourceEfficiency",
        "version": "1.0.0",
        "inputsDB": {
          "enabled": "false",
          "minBpp": "0.08",
          "legacyMinBpp": "0.04",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "chkSrcEff",
        "position": {
          "x": 780,
          "y": -72
        }
      },
      {
        "name": "Go To Converter Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "20ZN6oc41",
          "pluginId": "X4ANCc9vI"
        },
        "fpEnabled": true,
        "id": "V0fhZ7bDk",
        "position": {
          "x": 984,
          "y": 84
        }
      },
      {
        "name": "🛫 Go To Validator Flow (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "Yaax7LBej",
          "pluginId": "FShP88xbjPT"
        },
        "fpEnabled": true,
        "id": "goToValidatorPT",
        "position": {
          "x": 1248,
          "y": 60
        }
      },
      {
        "name": "Mark step: controller start",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "controller-start"
        },
        "fpEnabled": true,
        "id": "ctrlMarkStart",
        "position": {
          "x": 612,
          "y": -240
        }
      },
      {
        "name": "Mark step: quick health check done",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "controller-hc-done"
        },
        "fpEnabled": true,
        "id": "ctrlMarkHc",
        "position": {
          "x": 612,
          "y": -168
        }
      },
      {
        "name": "Queue to local node",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "CPU",
          "requiredNodeTags": "mapped,local"
        },
        "fpEnabled": true,
        "id": "ps-ThIC3R",
        "position": {
          "x": 612,
          "y": -276
        }
      },
      {
        "name": "Require English Audio",
        "sourceRepo": "Local",
        "pluginName": "requireEnglishAudio",
        "version": "1.0.0",
        "inputsDB": {
          "languages": "eng,en"
        },
        "fpEnabled": true,
        "id": "scRequireEng",
        "position": {
          "x": 612,
          "y": -120
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
          "x": 396,
          "y": 12
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
          "x": 612,
          "y": -36
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
          "x": 612,
          "y": 12
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
          "x": 612,
          "y": 60
        }
      },
      {
        "name": "Remove untagged audio",
        "sourceRepo": "Local",
        "pluginName": "removeUntaggedAudio",
        "version": "1.0.0",
        "inputsDB": {
          "languages": "eng,en"
        },
        "fpEnabled": true,
        "id": "scRemoveUntagged",
        "position": {
          "x": 612,
          "y": 108
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
          "x": 612,
          "y": 144
        }
      },
      {
        "name": "Split Streams (ffmpeg)",
        "sourceRepo": "Local",
        "pluginName": "ffmpegSplitStreams",
        "version": "1.0.0",
        "inputsDB": {
          "audioSubsDir": "/temp/.tdarr-remux-cache",
          "defaultMode": "passthrough"
        },
        "fpEnabled": true,
        "id": "scSplit",
        "position": {
          "x": 612,
          "y": 204
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
          "x": 396,
          "y": -72
        }
      }
    ],
    "flowEdges": [
      {
        "source": "classifySrc",
        "sourceHandle": "1",
        "target": "chkSrcEff",
        "targetHandle": null,
        "id": "h264NotHdrToConverter"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "2",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "h264HdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "3",
        "target": "chkForceReencode",
        "targetHandle": null,
        "id": "hevcNotHdrToForceCheck"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "4",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "hevcHdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "5",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "av1NotHdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "6",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "av1HdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "7",
        "target": "chkSrcEff",
        "targetHandle": null,
        "id": "legacyNotHdrToConverter"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "8",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "legacyHdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "9",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "otherNotHdrToClean"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "10",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "otherHdrToClean"
      },
      {
        "source": "chkForceReencode",
        "sourceHandle": "1",
        "target": "V0fhZ7bDk",
        "targetHandle": null,
        "id": "forceToConverter"
      },
      {
        "source": "chkForceReencode",
        "sourceHandle": "2",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "forceToClean"
      },
      {
        "source": "chkSrcEff",
        "sourceHandle": "2",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "effToClean"
      },
      {
        "source": "Pu7lH9MsN",
        "sourceHandle": "1",
        "target": "ctrlMarkHc",
        "targetHandle": null,
        "id": "ctrlE1"
      },
      {
        "source": "scSplit",
        "sourceHandle": "1",
        "target": "classifySrc",
        "targetHandle": null,
        "id": "ctrlE2"
      },
      {
        "source": "ctrlMarkHc",
        "sourceHandle": "1",
        "target": "scRequireEng",
        "targetHandle": null,
        "id": "ctrlE1b"
      },
      {
        "source": "ctrlMarkStart",
        "sourceHandle": "1",
        "target": "Pu7lH9MsN",
        "targetHandle": null,
        "id": "wX1SDPG_j"
      },
      {
        "source": "ps-ThIC3R",
        "sourceHandle": "1",
        "target": "ctrlMarkStart",
        "targetHandle": null,
        "id": "pAqRJHOFu"
      },
      {
        "source": "6sLbd7Q3m",
        "sourceHandle": "1",
        "target": "ps-ThIC3R",
        "targetHandle": null,
        "id": "Kd_QSFHUx"
      },
      {
        "source": "chkSrcEff",
        "sourceHandle": "1",
        "target": "V0fhZ7bDk",
        "targetHandle": null,
        "id": "-lDwGniMI"
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
        "target": "scSplit",
        "targetHandle": null,
        "id": "scE6"
      }
    ]
  });
exports.details = details;
