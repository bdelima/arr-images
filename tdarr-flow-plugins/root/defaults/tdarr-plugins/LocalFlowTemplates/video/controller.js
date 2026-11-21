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
// Synced to Bob's live "Controller (v15)" on 2026-11-19 (the version is stamped on at build, so the name here stays plain). Compared with the previous template: (1) Check Source Efficiency is enabled with both minimum bits per pixel set to 0, so it measures every file, sets the source bits-per-pixel and bitrate Flow Variables for Tag Output Metadata, and never skips one; its output 2 now goes to Go To Encoder (it went to the Muxer passthrough), so a file it did skip would be encoded anyway. (2) New "Check Clean Quality Tier" (Check Flow Variable, library variable qualityTier, value clean): Split Streams (ffmpeg) now goes to it instead of straight to Classify Source; output 1 (the library's tier is clean) goes to Go To Muxer (passthrough), output 2 goes to Classify Source, so a file from a clean-tier library skips Classify Source and the checks after it. The node has no condition saved in its inputs, so it uses the plugin's default condition. (3) "Check Force Reencode" is now "Check Best Quality Tier": it tests the library variable qualityTier == best (it tested forceReencode == true); output 1 now goes to Check Source Efficiency (it went to Go To Encoder), output 2 still goes to the Muxer passthrough. (4) Classify Source output 2 (H.264 HDR) now goes to Check Source Efficiency and output 4 (HEVC HDR) to Check Best Quality Tier; both went to the Muxer passthrough, so an HDR file of those two kinds is no longer passed through unconditionally. (5) "Go To Converter Flow" is now "Go To Encoder" and "Go To Validator Flow (passthrough)" is now "Go To Muxer (passthrough)" (flow ids and node ids unchanged). (6) Positions of Classify Source, Check Source Efficiency, Go To Encoder, Go To Muxer and Repair Language Tags changed. Nothing else changed.
// Flow ids, 2026-11-19: the three flows have readable ids, bdelima/Controller, bdelima/Encoder and bdelima/Muxer (they were HWxfel7zZ, 20ZN6oc41 and Yaax7LBej), and every Go To Flow node's flowId uses them. Ids written bdelima:Controller and so on were tried first: they imported, but the flow editor then opened the Controller for all three flows. Importing with Replace over a flow that still has the old id creates a new flow; the old one stays until it is deleted.
// Synced to Bob's live "Controller (v16)" on 2026-11-19 (the version is stamped on at build, so the name here stays plain), after Classify Source got its ten new outputs (1 h264, 2 hevc, 3 hevc+HDR/DoVi, 4 hevc+DoVi 4/5, 5 av1, 6 av1+HDR/DoVi, 7 av1+DoVi 4/5, 8 legacy, 9 other/unrecognized, 10 other/unrecognized HDR/DoVi). Compared with the v15 template, only two Classify Source edges changed: output 2 now goes to Check Best Quality Tier (it went to Check Source Efficiency, edge id cyDhRyNN2, now vpihbUuhJ), and output 4 now goes to Go To Muxer (passthrough) (it went to Check Best Quality Tier, edge id XokWO5-kI, now blOWM4wH_). The other Classify Source edges are as in v15. This replaces the Classify Source routing described in the v15 note above. The key order inside "Check Clean Quality Tier" follows the live export. No node, position or setting changed.
// Synced to Bob's live "Controller (v16)" on 2026-11-20 (the version is stamped on at build, so the name here stays plain). Compared with the previous template (20 nodes and 31 edges, now 19 and 29): "Check Best Quality Tier" (chkForceReencode) is gone together with its two edges (forceToClean, to Go To Muxer (passthrough), and sCVyxgHnN, to Check Source Efficiency). Four Classify Source edges changed, using the output meanings in the Controller (v16) note above: output 2 (hevc) now goes to Check Source Efficiency (it went to Check Best Quality Tier, edge vpihbUuhJ, now AM5Vodhgu); output 3 (hevc + HDR/DoVi) now goes to Check Source Efficiency (it went to Check Best Quality Tier, edge hevcNotHdrToForceCheck, now DFXYvUiH3); output 7 (av1 + Dolby Vision 4/5) now goes to Go To Muxer (passthrough) (it went to Check Source Efficiency, edge legacyNotHdrToConverter, now Aia2YQUi3); output 8 (legacy) now goes to Check Source Efficiency (it went to Go To Muxer (passthrough), edge legacyHdrToClean, now zUDTqFJT9). The other Classify Source edges (1 to Check Source Efficiency, 4, 5, 6, 9 and 10 to Go To Muxer (passthrough)) are as before, and both outputs of Check Source Efficiency still go to Go To Encoder. This replaces the Classify Source routing in the notes above. Eight node positions moved (Classify Source, Check Source Efficiency, Go To Encoder, Go To Muxer (passthrough), Fail Flow (no English audio), Split Streams (ffmpeg), Repair Language Tags, Check Clean Quality Tier); no other node or setting changed.
// H.264 SEI/SPS splice repair, 2026-11-21, synced to Bob's live Controller as he pasted it (named "Controller (v18)"; the version is stamped on at build, so the name here stays plain). Compared with the previous template (19 nodes and 29 edges, now 21 and 34): two new nodes between Split Streams (ffmpeg) and Check Clean Quality Tier, "Detect H.264 SEI/SPS Splice" (scDetectSplice, Only Scan After An SEI Warning on, position 828,84) and "Fix H.264 SEI/SPS Splice" (scFixSplice, position 828,156). The edge from Split Streams (ffmpeg) straight to Check Clean Quality Tier (imC5002CI) is gone; Split Streams (ffmpeg) output 1 now goes to Detect (scSplitToDetect), Detect output 1 (repairable) to Fix (scDetect1ToFix), Detect outputs 2 (nothing to fix) and 3 (differs in a way not repaired here) to Check Clean Quality Tier (scDetect2ToTier, scDetect3ToTier), and Fix outputs 1 (fixed) and 2 (nothing to fix) to Check Clean Quality Tier (scFix1ToTier, scFix2ToTier), so both the Clean path and the Encoder path run on the repaired file. Detect output 3 therefore carries on to the Encoder unrepaired. Split Streams (ffmpeg) moved from 828,96 to 828,48; no other node or setting changed.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "bdelima/Controller",
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
          "x": 1152,
          "y": -216
        }
      },
      {
        "name": "Check Source Efficiency",
        "sourceRepo": "Local",
        "pluginName": "checkSourceEfficiency",
        "version": "1.0.0",
        "inputsDB": {
          "enabled": "true",
          "minBpp": "0",
          "legacyMinBpp": "0",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "chkSrcEff",
        "position": {
          "x": 1236,
          "y": 96
        }
      },
      {
        "name": "Go To Encoder",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "bdelima/Encoder",
          "pluginId": "X4ANCc9vI"
        },
        "fpEnabled": true,
        "id": "V0fhZ7bDk",
        "position": {
          "x": 1236,
          "y": 180
        }
      },
      {
        "name": "🛫 Go To Muxer (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "bdelima/Muxer",
          "pluginId": "FShP88xbjPT"
        },
        "fpEnabled": true,
        "id": "goToValidatorPT",
        "position": {
          "x": 1044,
          "y": 168
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
          "x": 828,
          "y": -12
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
          "x": 828,
          "y": 48
        }
      },
      {
        "name": "Detect H.264 SEI/SPS Splice",
        "sourceRepo": "Local",
        "pluginName": "detectH264Splice",
        "version": "1.0.0",
        "inputsDB": {
          "onlyAfterWarning": "true"
        },
        "fpEnabled": true,
        "id": "scDetectSplice",
        "position": {
          "x": 828,
          "y": 84
        }
      },
      {
        "name": "Fix H.264 SEI/SPS Splice",
        "sourceRepo": "Local",
        "pluginName": "fixH264Splice",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "scFixSplice",
        "position": {
          "x": 828,
          "y": 156
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
          "x": 828,
          "y": -72
        }
      },
      {
        "name": "Check Clean Quality Tier",
        "sourceRepo": "Community",
        "pluginName": "checkFlowVariable",
        "version": "1.0.0",
        "inputsDB": {
          "variable": "{{{args.userVariables.library.qualityTier}}}",
          "value": "clean"
        },
        "fpEnabled": true,
        "id": "Fu2JDoG05",
        "position": {
          "x": 1056,
          "y": -300
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
        "source": "Pu7lH9MsN",
        "sourceHandle": "1",
        "target": "ctrlMarkHc",
        "targetHandle": null,
        "id": "ctrlE1"
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
      },
      {
        "source": "chkSrcEff",
        "sourceHandle": "2",
        "target": "V0fhZ7bDk",
        "targetHandle": null,
        "id": "LVe7-orLH"
      },
      {
        "source": "scSplit",
        "sourceHandle": "1",
        "target": "scDetectSplice",
        "targetHandle": null,
        "id": "scSplitToDetect"
      },
      {
        "source": "scDetectSplice",
        "sourceHandle": "1",
        "target": "scFixSplice",
        "targetHandle": null,
        "id": "scDetect1ToFix"
      },
      {
        "source": "scDetectSplice",
        "sourceHandle": "2",
        "target": "Fu2JDoG05",
        "targetHandle": null,
        "id": "scDetect2ToTier"
      },
      {
        "source": "scDetectSplice",
        "sourceHandle": "3",
        "target": "Fu2JDoG05",
        "targetHandle": null,
        "id": "scDetect3ToTier"
      },
      {
        "source": "scFixSplice",
        "sourceHandle": "1",
        "target": "Fu2JDoG05",
        "targetHandle": null,
        "id": "scFix1ToTier"
      },
      {
        "source": "scFixSplice",
        "sourceHandle": "2",
        "target": "Fu2JDoG05",
        "targetHandle": null,
        "id": "scFix2ToTier"
      },
      {
        "source": "Fu2JDoG05",
        "sourceHandle": "2",
        "target": "classifySrc",
        "targetHandle": null,
        "id": "SlveGSk32"
      },
      {
        "source": "Fu2JDoG05",
        "sourceHandle": "1",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "PphZkva6y"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "4",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "blOWM4wH_"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "7",
        "target": "goToValidatorPT",
        "targetHandle": null,
        "id": "Aia2YQUi3"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "8",
        "target": "chkSrcEff",
        "targetHandle": null,
        "id": "zUDTqFJT9"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "3",
        "target": "chkSrcEff",
        "targetHandle": null,
        "id": "DFXYvUiH3"
      },
      {
        "source": "classifySrc",
        "sourceHandle": "2",
        "target": "chkSrcEff",
        "targetHandle": null,
        "id": "AM5Vodhgu"
      }
    ]
  });
exports.details = details;
