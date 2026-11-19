'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Live Tdarr flow "Muxer" (original flow _id: Yaax7LBej; it was called "Validator" until 2026-11-18), brought up to Bob's live "Muxer (v14)" on 2026-11-18 (the version suffix is stamped on at image build, so the name here stays plain). It puts the audio+subs file back together with the video-only file (mkvmerge Execute in combine mode), routes the job to the node that does the merge, and ends in Tag Output Metadata and Replace Original File. The VMAF nodes, the 4K and 10-bit checks and the Require Review node that the older Validator template had are not in the live flow, so they are not here.
// Entry from Encoder Flow (re-encoded) (QgTm1GUmZ) goes to Classify Source (ViEmkfGP4); its outputs 2, 4, 6, 8 and 10 (the HDR and Dolby Vision classes) go to the Dolby Vision / HDR10+ re-injection, the others (1, 3, 5, 7, 9) to the merge as before. Entry from Controller Flow (final merge) (FShP88xbjPT) goes straight to the merge. After the merge both paths go through Compare File Duration Ratio, Queue Full Healthcheck and Run Thorough Health Check, the Require health check before Replace gate, Route to local node and Mark step, then Tag Output Metadata and Replace Original File.
// Dolby Vision / HDR10+ re-injection, added 2026-11-18: Route to a local node (injRoute, CPU worker, tags mapped,local), Mark step validator-inject-start (injMark), then one node per step, each a Local plugin (DoVi/HDR: Look In Source, HDR10+: Extract From Source, Dolby Vision: Extract RPU From Source, DoVi/HDR: Count Encode Frames, Dolby Vision: Check RPU Frame Count, DoVi/HDR: Write Raw HEVC Stream, HDR10+: Inject Into Stream, Dolby Vision: Inject RPU Into Stream, DoVi/HDR: Mux To MKV, DoVi/HDR: Verify Result, DoVi/HDR: Clean Up Work Files). A source with neither goes straight on to the merge; Profile 4, Profile 5 and any other unsupported Dolby Vision profile, a frame count mismatch, metadata that does not fit the stream and a failed read-back go to a Fail Flow node (one node per kind of failure, see the Layout note below). The steps share their results in the Flow Variables user.inj*; the working file is the re-encode and the Flow Variable videoOnlySource is the video-only file it was made from.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
// Layout, 2026-11-19: the node positions are the owner's own arrangement from the flow editor. The Controller entry and the merge, health check and output nodes are the left lane; the Encoder entry, Classify Source and the Dolby Vision / HDR10+ re-injection steps are the right lane, and the re-injection steps rejoin the merge at Mark step: on local node (merge). Each re-injection failure now has its own Fail Flow node: Fail Flow (profile not supported) (HKLf4mn-H, from Look In Source output 5), Fail Flow (RPU frame count error) (RsUdPvlXO, from Check RPU Frame Count output 2), Fail Flow (re-injection) (XydlOn9Mc, from Inject Into Stream output 3 of the HDR10+ step), Fail Flow (RPU stream mismatch) (eFlUknnPN, from Inject RPU Into Stream output 2) and Fail Flow (RPU/HDR10+ mismatch) (injFail, from Verify Result output 2). The original Fail Flow (WrieN1BV1) takes the Compare File Duration Ratio and Require health check before Replace failures. Compared with the previous template, only positions, these five Fail Flow nodes and the edges into them changed (edges injE11, injE18, injE23 and injE25 were replaced by acv5oUiD8, RXEKPz6_8, NHUWAZ8TN and zoaN5xT2P, and injE28 now ends at injFail); no other node, edge or setting did.
// Flow ids, 2026-11-19: the three flows have readable ids, bdelima/Controller, bdelima/Encoder and bdelima/Muxer (they were HWxfel7zZ, 20ZN6oc41 and Yaax7LBej), and every Go To Flow node's flowId uses them. Ids written bdelima:Controller and so on were tried first: they imported, but the flow editor then opened the Controller for all three flows. Importing with Replace over a flow that still has the old id creates a new flow; the old one stays until it is deleted.
// Synced to Bob's live "Muxer (v17)" on 2026-11-19 (the version is stamped on at build, so the name here stays plain), after Classify Source got its ten new outputs. Compared with the previous template, only two Classify Source edges changed: output 2 now goes to Route to local node (merge) (it went to Route to local node (inject), edge id injE00, now MjRToxD_v) and output 3 now goes to Route to local node (inject) (it went to Route to local node (merge), edge id vW8eDUflT, now s7yzStjD_). The other Classify Source edges (1, 5, 7, 9 to the merge route, 4, 6, 8, 10 to the inject route) are as before. This replaces the output routing described in the second note above (outputs 2, 4, 6, 8 and 10 to the re-injection). No node, position or setting changed.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "bdelima/Muxer",
    "name": "Muxer",
    "description": "Muxer",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Fail Flow (re-injection)",
        "sourceRepo": "Community",
        "pluginName": "failFlow",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "XydlOn9Mc",
        "position": {
          "x": 528,
          "y": 624
        }
      },
      {
        "name": "Fail Flow (RPU stream mismatch)",
        "sourceRepo": "Community",
        "pluginName": "failFlow",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "eFlUknnPN",
        "position": {
          "x": 1080,
          "y": 360
        }
      },
      {
        "name": "Fail Flow (RPU frame count error)",
        "sourceRepo": "Community",
        "pluginName": "failFlow",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "RsUdPvlXO",
        "position": {
          "x": 1068,
          "y": 276
        }
      },
      {
        "name": "Fail Flow (profile not supported)",
        "sourceRepo": "Community",
        "pluginName": "failFlow",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "HKLf4mn-H",
        "position": {
          "x": 1068,
          "y": 192
        }
      },
      {
        "name": "Entry from Encoder Flow (re-encoded)",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "QgTm1GUmZ",
        "position": {
          "x": 444,
          "y": -48
        }
      },
      {
        "name": "Fail Flow",
        "sourceRepo": "Community",
        "pluginName": "failFlow",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "WrieN1BV1",
        "position": {
          "x": 324,
          "y": 504
        }
      },
      {
        "name": "Tag Output Metadata",
        "sourceRepo": "Local",
        "pluginName": "tagOutputMetadata",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "tagOutMeta",
        "position": {
          "x": 96,
          "y": 648
        }
      },
      {
        "name": "Replace Original File",
        "sourceRepo": "Community",
        "pluginName": "replaceOriginalFile",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "1g5GNL1MP",
        "position": {
          "x": 96,
          "y": 684
        }
      },
      {
        "name": "Entry from Controller Flow (final merge)",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "FShP88xbjPT",
        "position": {
          "x": 216,
          "y": -48
        }
      },
      {
        "name": "Compare File Duration Ratio (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "compareFileDurationRatio",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "CUsET8PD3PT",
        "position": {
          "x": 216,
          "y": 276
        }
      },
      {
        "name": "Queue Full Healthcheck",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "healthcheck-full"
        },
        "fpEnabled": true,
        "id": "reqOjochalHC",
        "position": {
          "x": 132,
          "y": 348
        }
      },
      {
        "name": "Run Thorough Health Check",
        "sourceRepo": "Community",
        "pluginName": "runHealthCheck",
        "version": "1.0.0",
        "inputsDB": {
          "type": "thorough",
          "gpuAcceleration": "qsv"
        },
        "fpEnabled": true,
        "id": "healthCheckPT",
        "position": {
          "x": -60,
          "y": 408
        }
      },
      {
        "name": "Mark step: landed for health check",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-hc-queue"
        },
        "fpEnabled": true,
        "id": "valMarkHcQueue",
        "position": {
          "x": -60,
          "y": 360
        }
      },
      {
        "name": "Mark step: thorough health check done",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-hc-done"
        },
        "fpEnabled": true,
        "id": "valMarkHcDone",
        "position": {
          "x": -60,
          "y": 456
        }
      },
      {
        "name": "Require health check before Replace",
        "sourceRepo": "Local",
        "pluginName": "requireTrail",
        "version": "1.0.0",
        "inputsDB": {
          "requiredLabels": "validator-hc-queue,validator-hc-done"
        },
        "fpEnabled": true,
        "id": "valRequireHc",
        "position": {
          "x": 120,
          "y": 504
        }
      },
      {
        "name": "Mark step: on vmaf node",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-on-local"
        },
        "fpEnabled": true,
        "id": "JbNGlNa6-",
        "position": {
          "x": 96,
          "y": 612
        }
      },
      {
        "name": "Route to local node",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "CPU",
          "requiredNodeTags": "mapped,local"
        },
        "fpEnabled": true,
        "id": "rvn34_UFh",
        "position": {
          "x": 96,
          "y": 576
        }
      },
      {
        "name": "Route to local node (merge)",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredNodeTags": "mapped,local",
          "requiredWorkerType": "CPU"
        },
        "fpEnabled": true,
        "id": "valRoutePT",
        "position": {
          "x": 216,
          "y": 72
        }
      },
      {
        "name": "Mark step: on local node (merge)",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-merged-pt"
        },
        "fpEnabled": true,
        "id": "valMarkPT",
        "position": {
          "x": 216,
          "y": 144
        }
      },
      {
        "name": "mkvmerge (final combine)",
        "sourceRepo": "Local",
        "pluginName": "mkvmergeExecute",
        "version": "1.0.0",
        "inputsDB": {
          "mode": "combine",
          "audioSubsDir": "/temp/.tdarr-remux-cache"
        },
        "fpEnabled": true,
        "id": "valMergePT",
        "position": {
          "x": 216,
          "y": 192
        }
      },
      {
        "name": "Cleanup audio+subs cache file",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "userCli": "mkvmerge",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "false",
          "cliArguments": "-c rm -f \"/temp/.tdarr-remux-cache/{{{args.originalLibraryFile.fileNameWithoutExtension}}}-audiosubs.mkv\"",
          "outputFileBecomesWorkingFile": "false"
        },
        "fpEnabled": true,
        "id": "valCleanPT",
        "position": {
          "x": 216,
          "y": 228
        }
      },
      {
        "name": "Classify Source",
        "sourceRepo": "Local",
        "pluginName": "classifySource",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "ViEmkfGP4",
        "position": {
          "x": 648,
          "y": -24
        }
      },
      {
        "name": "Route to local node (inject)",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "CPU",
          "requiredNodeTags": "mapped,local"
        },
        "fpEnabled": true,
        "id": "injRoute",
        "position": {
          "x": 756,
          "y": 48
        }
      },
      {
        "name": "Mark step: on local node (inject)",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-inject-start"
        },
        "fpEnabled": true,
        "id": "injMark",
        "position": {
          "x": 756,
          "y": 84
        }
      },
      {
        "name": "DoVi/HDR: Look In Source",
        "sourceRepo": "Local",
        "pluginName": "doviLookInSource",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injLook",
        "position": {
          "x": 756,
          "y": 132
        }
      },
      {
        "name": "HDR10+: Extract From Source",
        "sourceRepo": "Local",
        "pluginName": "hdr10PlusExtract",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injHdrX",
        "position": {
          "x": 612,
          "y": 228
        }
      },
      {
        "name": "Dolby Vision: Extract RPU From Source",
        "sourceRepo": "Local",
        "pluginName": "doviExtractRpu",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injRpuX",
        "position": {
          "x": 840,
          "y": 252
        }
      },
      {
        "name": "DoVi/HDR: Count Encode Frames",
        "sourceRepo": "Local",
        "pluginName": "doviCountFrames",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injCount",
        "position": {
          "x": 636,
          "y": 324
        }
      },
      {
        "name": "Dolby Vision: Check RPU Frame Count",
        "sourceRepo": "Local",
        "pluginName": "doviCheckRpuFrames",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injCheck",
        "position": {
          "x": 852,
          "y": 360
        }
      },
      {
        "name": "DoVi/HDR: Write Raw HEVC Stream",
        "sourceRepo": "Local",
        "pluginName": "doviWriteRawStream",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injRaw",
        "position": {
          "x": 660,
          "y": 420
        }
      },
      {
        "name": "HDR10+: Inject Into Stream",
        "sourceRepo": "Local",
        "pluginName": "hdr10PlusInject",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injHdrI",
        "position": {
          "x": 516,
          "y": 504
        }
      },
      {
        "name": "Dolby Vision: Inject RPU Into Stream",
        "sourceRepo": "Local",
        "pluginName": "doviInjectRpu",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injRpuI",
        "position": {
          "x": 876,
          "y": 516
        }
      },
      {
        "name": "DoVi/HDR: Mux To MKV",
        "sourceRepo": "Local",
        "pluginName": "doviMuxResult",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injMux",
        "position": {
          "x": 720,
          "y": 600
        }
      },
      {
        "name": "DoVi/HDR: Verify Result",
        "sourceRepo": "Local",
        "pluginName": "doviVerifyResult",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injVerify",
        "position": {
          "x": 720,
          "y": 636
        }
      },
      {
        "name": "DoVi/HDR: Clean Up Work Files",
        "sourceRepo": "Local",
        "pluginName": "doviCleanUp",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injClean",
        "position": {
          "x": 648,
          "y": 696
        }
      },
      {
        "name": "Fail Flow (RPU/HDR10+ mismatch)",
        "sourceRepo": "Community",
        "pluginName": "failFlow",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injFail",
        "position": {
          "x": 1080,
          "y": 624
        }
      }
    ],
    "flowEdges": [
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "U2MS0RqpEPT"
      },
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "6FytNy0H9PT"
      },
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "1",
        "target": "reqOjochalHC",
        "targetHandle": null,
        "id": "ratioToReqOjochal"
      },
      {
        "source": "reqOjochalHC",
        "sourceHandle": "1",
        "target": "valMarkHcQueue",
        "targetHandle": null,
        "id": "reqOjochalToHC"
      },
      {
        "source": "healthCheckPT",
        "sourceHandle": "1",
        "target": "valMarkHcDone",
        "targetHandle": null,
        "id": "hcToReqLocal"
      },
      {
        "source": "valMarkHcQueue",
        "sourceHandle": "1",
        "target": "healthCheckPT",
        "targetHandle": null,
        "id": "reqOjochalToHCb"
      },
      {
        "source": "valRequireHc",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "gateToFail"
      },
      {
        "source": "valMarkHcDone",
        "sourceHandle": "1",
        "target": "valRequireHc",
        "targetHandle": null,
        "id": "iR16UZ4VY"
      },
      {
        "source": "tagOutMeta",
        "sourceHandle": "1",
        "target": "1g5GNL1MP",
        "targetHandle": null,
        "id": "451iXsWSo"
      },
      {
        "source": "valRequireHc",
        "sourceHandle": "1",
        "target": "rvn34_UFh",
        "targetHandle": null,
        "id": "jJ00OkqOj"
      },
      {
        "source": "rvn34_UFh",
        "sourceHandle": "1",
        "target": "JbNGlNa6-",
        "targetHandle": null,
        "id": "OYzhHw0HF"
      },
      {
        "source": "JbNGlNa6-",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "_DTW22_4d"
      },
      {
        "source": "FShP88xbjPT",
        "sourceHandle": "1",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "ePT0"
      },
      {
        "source": "valRoutePT",
        "sourceHandle": "1",
        "target": "valMarkPT",
        "targetHandle": null,
        "id": "ePT1"
      },
      {
        "source": "valMarkPT",
        "sourceHandle": "1",
        "target": "valMergePT",
        "targetHandle": null,
        "id": "ePT2"
      },
      {
        "source": "valMergePT",
        "sourceHandle": "1",
        "target": "valCleanPT",
        "targetHandle": null,
        "id": "ePT3"
      },
      {
        "source": "valCleanPT",
        "sourceHandle": "1",
        "target": "CUsET8PD3PT",
        "targetHandle": null,
        "id": "jFFhjdPsv"
      },
      {
        "source": "QgTm1GUmZ",
        "sourceHandle": "1",
        "target": "ViEmkfGP4",
        "targetHandle": null,
        "id": "k5-6oq4s7"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "1",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "pujIC4cNc"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "5",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "KSKJj_p0A"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "7",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "A3zSeIXBl"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "9",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "9t8RwjZmA"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "4",
        "target": "injRoute",
        "targetHandle": null,
        "id": "injE01"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "6",
        "target": "injRoute",
        "targetHandle": null,
        "id": "injE02"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "8",
        "target": "injRoute",
        "targetHandle": null,
        "id": "injE03"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "10",
        "target": "injRoute",
        "targetHandle": null,
        "id": "injE04"
      },
      {
        "source": "injRoute",
        "sourceHandle": "1",
        "target": "injMark",
        "targetHandle": null,
        "id": "injE05"
      },
      {
        "source": "injMark",
        "sourceHandle": "1",
        "target": "injLook",
        "targetHandle": null,
        "id": "injE06"
      },
      {
        "source": "injLook",
        "sourceHandle": "1",
        "target": "valMarkPT",
        "targetHandle": null,
        "id": "injE07"
      },
      {
        "source": "injLook",
        "sourceHandle": "2",
        "target": "injHdrX",
        "targetHandle": null,
        "id": "injE08"
      },
      {
        "source": "injLook",
        "sourceHandle": "3",
        "target": "injRpuX",
        "targetHandle": null,
        "id": "injE09"
      },
      {
        "source": "injLook",
        "sourceHandle": "4",
        "target": "injHdrX",
        "targetHandle": null,
        "id": "injE10"
      },
      {
        "source": "injHdrX",
        "sourceHandle": "1",
        "target": "injRpuX",
        "targetHandle": null,
        "id": "injE12"
      },
      {
        "source": "injHdrX",
        "sourceHandle": "2",
        "target": "injCount",
        "targetHandle": null,
        "id": "injE13"
      },
      {
        "source": "injRpuX",
        "sourceHandle": "1",
        "target": "injCount",
        "targetHandle": null,
        "id": "injE14"
      },
      {
        "source": "injCount",
        "sourceHandle": "1",
        "target": "injCheck",
        "targetHandle": null,
        "id": "injE15"
      },
      {
        "source": "injCount",
        "sourceHandle": "2",
        "target": "injRaw",
        "targetHandle": null,
        "id": "injE16"
      },
      {
        "source": "injCheck",
        "sourceHandle": "1",
        "target": "injRaw",
        "targetHandle": null,
        "id": "injE17"
      },
      {
        "source": "injRaw",
        "sourceHandle": "1",
        "target": "injHdrI",
        "targetHandle": null,
        "id": "injE19"
      },
      {
        "source": "injRaw",
        "sourceHandle": "2",
        "target": "injRpuI",
        "targetHandle": null,
        "id": "injE20"
      },
      {
        "source": "injHdrI",
        "sourceHandle": "1",
        "target": "injRpuI",
        "targetHandle": null,
        "id": "injE21"
      },
      {
        "source": "injHdrI",
        "sourceHandle": "2",
        "target": "injMux",
        "targetHandle": null,
        "id": "injE22"
      },
      {
        "source": "injRpuI",
        "sourceHandle": "1",
        "target": "injMux",
        "targetHandle": null,
        "id": "injE24"
      },
      {
        "source": "injMux",
        "sourceHandle": "1",
        "target": "injVerify",
        "targetHandle": null,
        "id": "injE26"
      },
      {
        "source": "injVerify",
        "sourceHandle": "1",
        "target": "injClean",
        "targetHandle": null,
        "id": "injE27"
      },
      {
        "source": "injVerify",
        "sourceHandle": "2",
        "target": "injFail",
        "targetHandle": null,
        "id": "injE28"
      },
      {
        "source": "injClean",
        "sourceHandle": "1",
        "target": "valMarkPT",
        "targetHandle": null,
        "id": "injE29"
      },
      {
        "source": "injLook",
        "sourceHandle": "5",
        "target": "HKLf4mn-H",
        "targetHandle": null,
        "id": "acv5oUiD8"
      },
      {
        "source": "injCheck",
        "sourceHandle": "2",
        "target": "RsUdPvlXO",
        "targetHandle": null,
        "id": "RXEKPz6_8"
      },
      {
        "source": "injRpuI",
        "sourceHandle": "2",
        "target": "eFlUknnPN",
        "targetHandle": null,
        "id": "zoaN5xT2P"
      },
      {
        "source": "injHdrI",
        "sourceHandle": "3",
        "target": "XydlOn9Mc",
        "targetHandle": null,
        "id": "NHUWAZ8TN"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "2",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "MjRToxD_v"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "3",
        "target": "injRoute",
        "targetHandle": null,
        "id": "s7yzStjD_"
      }
    ]
  });
exports.details = details;
