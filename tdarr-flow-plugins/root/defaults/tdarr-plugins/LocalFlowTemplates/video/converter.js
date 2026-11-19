'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "264 to 265 Converter" (originally _id YEZ9GlGHp, now 20ZN6oc41) on 2026-11-08, then changed so that every remux step is the mkvmerge Execute plugin (mkvmergeExecute) instead of ffmpeg: the
// Remove video streams node is gone (audioSubs mode leaves video out) and Entry goes straight to the audio+subs step.
// Brought up to the live "Converter (0.6.0)" on 2026-11-10 (the build stamps the template's version onto the name, so the name here stays
// plain; the live flow is now called "Converter"). Changes from that update: the "Route to local CPU (demux path)" and "Mark step:
// landed on local (demux)" nodes are gone, so "Mark step: encode done" leads straight into the final mkvmerge combine; node positions moved.
// Brought up to the live "Converter (v11)" on 2026-11-11: after "Mark step: encode done" new "Route to mapped nodes" (Tags: Worker Type, CPU worker on a node tagged mapped) and
// "Mark step: landed on mapped node" (label converter-encode-mapped) come before the final mkvmerge combine, so an encode that ran on an unmapped node goes back to a mapped node,
// which downloads the encoded file from the server, before the combine reads the shared remux cache. "Route to encoder (GPU)" is renamed "Route to encoder nodes"; node positions moved.
// Quality tier, 2026-11-12: "Set Source-Relative Bitrate" (the QVBR cap) is replaced by "Set Quality With Node Offset", which adds the encode node's offset to the baseline quality (the Flow Variable
// tdarrQuality from the Controller's "Set Encode Quality", else the number Set Video Encoder wrote) and still records the source average and peak bitrate for the output tags. No bitrate cap is set.
// The template ships drakebay-gpu=-3: on one 1080p50 source, drakebay ICQ 28 gave 4478 kbps and ojochal ICQ 31 gave 4389 kbps, at near-equal VMAF.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
// Synced to Bob's live "Encoder (v13)" on 2026-11-15; the flow is now named Encoder (it was Converter). The single encode path is split by frame rate (Check Video Framerate, less than 31 fps): under 30 fps it goes to nodes tagged encoder and a Check Node Hardware Encoder (hevc_vaapi) picks the VAAPI encoder (quality 20) or the QSV encoder (quality 18); above 30 fps it goes to nodes tagged encoder,high-fps and the VAAPI encoder (quality 29). Each path has its own Set Quality Node Offset (drakebay-gpu=0, samara-encoder=-2 under 30 fps and -6 above). Keep Awake nodes stop and allow Windows sleep around the encode, "Route to mapped nodes" is now "Route to local node" (mapped,local), and the nodes were laid out again.
// Demux restructure, 2026-11-16: the Encoder works on video only. The Stream Cleanup flow now splits the file (video-only working file plus an audio+subs file in /temp/.tdarr-remux-cache), so the audio+subs step, the stable-path copy, the video-from-original step, the Route to local node / Mark step, the final mkvmerge combine and the cache cleanup are gone from here; Entry goes straight to Check Video Framerate and, after Mark step: encode done and Allow sleep, back to the Controller. The Validator puts the file back together (mkvmerge combine) at its top.
// Synced to Bob's live "Encoder (v14)" on 2026-11-19 (the previous template had 20 nodes, this one has 44; every node it had is unchanged apart from position, except the last Go To Flow node). The VMAF scoring and the size checks are in the Encoder now, not in the Muxer. After Execute (encode) the job is routed to a node tagged vmaf (Route to VMAF node, Mark Step: on vmaf node); Check Video Resolution and Check 10 Bit Video choose one of four Run VMAF Quality Check nodes, which score against the video-only file (Flow Variable videoOnlySource). A pass goes through Compare File Size To Source to Mark step: encode done, Route to same encoder (the node Save Current Node recorded), Allow sleep (Windows), Require Review and "Go to validator flow (re-encoded)", which is the Muxer's "Entry from Encoder Flow" (QgTm1GUmZ). A failed VMAF check goes through the other Compare File Size To Source and Route to same encoder, and Set Working File (the video-only file) puts it back in front of Begin Command (encode) for another encode; Set Quality Tier Offset and Set Re-Encode Offset sit between the node offsets and Tag Encode Settings. When Set Re-Encode Offset output 2 or a Compare File Size To Source output 2 is taken, the job goes through Mark step: Restored original and Restore original file (the video-only file) to Route to same encoder, Allow sleep (Windows), Require Review and "Go to validator flow (final merge)", the Muxer's "Entry from Controller Flow" (FShP88xbjPT), so the source is not re-encoded. The old "Returning to Controller Flow" node (pointing at the Controller's retFromConv) is gone. How the outputs of those nodes behave is what the node names and edges say; none of it was run for this note.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "20ZN6oc41",
    "name": "Encoder",
    "description": "Encoder",
    "tags": "",
    "flowPlugins": [
      {
        "name": "🛫 Go to validator flow (final merge)",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "Yaax7LBej",
          "pluginId": "FShP88xbjPT"
        },
        "fpEnabled": true,
        "id": "aixyWixBS",
        "position": {
          "x": 96,
          "y": 696
        }
      },
      {
        "name": "Require Review",
        "sourceRepo": "Community",
        "pluginName": "requireReview",
        "version": "1.0.0",
        "id": "nEHxHExS_",
        "position": {
          "x": 96,
          "y": 660
        },
        "fpEnabled": true
      },
      {
        "name": "Allow sleep (Windows)",
        "sourceRepo": "Local",
        "pluginName": "keepAwake",
        "version": "1.0.0",
        "inputsDB": {
          "action": "stop"
        },
        "fpEnabled": true,
        "id": "-VSvE2yuT",
        "position": {
          "x": 96,
          "y": 624
        }
      },
      {
        "name": "Route to same encoder",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "id": "Z8P_D62AP",
        "position": {
          "x": 96,
          "y": 588
        },
        "fpEnabled": true,
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "{{{args.variables.user.savedNode}}}"
        }
      },
      {
        "name": "Route to same encoder",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "id": "7OnFaYshn",
        "position": {
          "x": 432,
          "y": 588
        },
        "fpEnabled": true,
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "{{{args.variables.user.savedNode}}}"
        }
      },
      {
        "name": "Entry from Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "X4ANCc9vI",
        "position": {
          "x": 420,
          "y": -144
        }
      },
      {
        "name": "Route to >30fps encoder nodes",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "encoder,high-fps"
        },
        "fpEnabled": true,
        "id": "tHF4vUCsM",
        "position": {
          "x": 624,
          "y": -72
        }
      },
      {
        "name": "Begin Command (encode)",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandStart",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "ehGAkWvj7",
        "position": {
          "x": 828,
          "y": 96
        }
      },
      {
        "name": "<30fps VAAPI Encoder",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandSetVideoEncoder",
        "version": "1.0.0",
        "inputsDB": {
          "outputCodec": "hevc",
          "ffmpegPresetEnabled": "true",
          "ffmpegPreset": "slow",
          "ffmpegQualityEnabled": "true",
          "ffmpegQuality": "20",
          "hardwareEncoding": "true",
          "hardwareType": "vaapi",
          "hardwareDecoding": "true",
          "forceEncoding": "true"
        },
        "fpEnabled": true,
        "id": "FAc9QeWJK",
        "position": {
          "x": 1044,
          "y": 252
        }
      },
      {
        "name": "Set Quality Node Offset (<30fps)",
        "sourceRepo": "Local",
        "pluginName": "setQualityWithNodeOffset",
        "version": "1.0.0",
        "inputsDB": {
          "nodeOffsets": "drakebay-gpu=0\nsamara-encoder=-2",
          "peakWindowSeconds": "2",
          "peakPercentile": "100",
          "peakScanTimeoutSeconds": "300",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "qualOffset",
        "position": {
          "x": 1140,
          "y": 324
        }
      },
      {
        "name": "Tag Encode Settings",
        "sourceRepo": "Local",
        "pluginName": "tagEncodeSettings",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "d7QK1TBlh",
        "position": {
          "x": 564,
          "y": 132
        }
      },
      {
        "name": "Execute (encode)",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandExecute",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "Y40uvSwMF",
        "position": {
          "x": 360,
          "y": 120
        }
      },
      {
        "name": "🛫 Go to validator flow (re-encoded)",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "Yaax7LBej",
          "pluginId": "QgTm1GUmZ"
        },
        "fpEnabled": true,
        "id": "b8n51xYj4",
        "position": {
          "x": 432,
          "y": 696
        }
      },
      {
        "name": "Mark step: landed on standard fps encoder",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "converter-encode-start"
        },
        "fpEnabled": true,
        "id": "cnvMarkEnc",
        "position": {
          "x": 396,
          "y": 12
        }
      },
      {
        "name": "Mark step: encode done",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "converter-encode-done"
        },
        "fpEnabled": true,
        "id": "cnvMarkEncDone",
        "position": {
          "x": 432,
          "y": 552
        }
      },
      {
        "name": "<30fps QSV Encoder",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandSetVideoEncoder",
        "version": "1.0.0",
        "inputsDB": {
          "outputCodec": "hevc",
          "ffmpegPresetEnabled": "true",
          "ffmpegPreset": "slow",
          "ffmpegQualityEnabled": "true",
          "ffmpegQuality": "18",
          "hardwareEncoding": "true",
          "hardwareType": "qsv",
          "hardwareDecoding": "true",
          "forceEncoding": "true"
        },
        "fpEnabled": true,
        "id": "8V9_07K-F",
        "position": {
          "x": 1152,
          "y": 192
        }
      },
      {
        "name": "Mark step: landed on high fps encoder",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "converter-encode-start"
        },
        "fpEnabled": true,
        "id": "7D1MRCH2-",
        "position": {
          "x": 828,
          "y": -72
        }
      },
      {
        "name": "Set >30fps Video Encoder",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandSetVideoEncoder",
        "version": "1.0.0",
        "inputsDB": {
          "outputCodec": "hevc",
          "ffmpegPresetEnabled": "true",
          "ffmpegPreset": "slow",
          "ffmpegQualityEnabled": "true",
          "ffmpegQuality": "29",
          "hardwareEncoding": "true",
          "hardwareType": "vaapi",
          "hardwareDecoding": "true",
          "forceEncoding": "true"
        },
        "fpEnabled": true,
        "id": "Rn3WUT-NN",
        "position": {
          "x": 1320,
          "y": 156
        }
      },
      {
        "name": "Route to <30fps encoder nodes",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "encoder"
        },
        "fpEnabled": true,
        "id": "-RGSfdo8K",
        "position": {
          "x": 396,
          "y": -36
        }
      },
      {
        "name": "Set Quality Node Offset (>30fps)",
        "sourceRepo": "Local",
        "pluginName": "setQualityWithNodeOffset",
        "version": "1.0.0",
        "inputsDB": {
          "nodeOffsets": "drakebay-gpu=0\nsamara-encoder=-6",
          "peakWindowSeconds": "2",
          "peakPercentile": "100",
          "peakScanTimeoutSeconds": "300",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "N2YufVfRT",
        "position": {
          "x": 1320,
          "y": 324
        }
      },
      {
        "name": "Check Video Framerate",
        "sourceRepo": "Community",
        "pluginName": "CheckVideoFramerate",
        "version": "1.0.0",
        "inputsDB": {
          "lessThan": "31"
        },
        "fpEnabled": true,
        "id": "EuW3bnW-x",
        "position": {
          "x": 1080,
          "y": 36
        }
      },
      {
        "name": "Check Video Framerate",
        "sourceRepo": "Community",
        "pluginName": "CheckVideoFramerate",
        "version": "1.0.0",
        "inputsDB": {
          "greaterThan": "0",
          "lessThan": "31"
        },
        "fpEnabled": true,
        "id": "YbKi7dgS7",
        "position": {
          "x": 420,
          "y": -96
        }
      },
      {
        "name": "Check Node Hardware Encoder VAAPI",
        "sourceRepo": "Community",
        "pluginName": "checkNodeHardwareEncoder",
        "version": "1.0.0",
        "inputsDB": {
          "hardwareEncoder": "hevc_vaapi"
        },
        "fpEnabled": true,
        "id": "wEp4vfM6B",
        "position": {
          "x": 1080,
          "y": 120
        }
      },
      {
        "name": "Prevent sleep (Windows)",
        "sourceRepo": "Local",
        "pluginName": "keepAwake",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "iIepjcd-i",
        "position": {
          "x": 1080,
          "y": 0
        }
      },
      {
        "name": "Allow sleep (Windows)",
        "sourceRepo": "Local",
        "pluginName": "keepAwake",
        "version": "1.0.0",
        "inputsDB": {
          "action": "stop"
        },
        "fpEnabled": true,
        "id": "yCde19y26",
        "position": {
          "x": 432,
          "y": 624
        }
      },
      {
        "name": "Set Quality Tier Offset",
        "sourceRepo": "Local",
        "pluginName": "setQualityWithTierOffset",
        "version": "1.0.0",
        "id": "Qf53O8A67",
        "position": {
          "x": 1248,
          "y": 408
        },
        "fpEnabled": true,
        "inputsDB": {
          "tierOffsets": "best=0\nbetter=+1\nbalanced=+2\nsmallest=+4"
        }
      },
      {
        "name": "Route to VMAF node",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "id": "v27whxM07",
        "position": {
          "x": 132,
          "y": 24
        },
        "fpEnabled": true,
        "inputsDB": {
          "requiredWorkerType": "CPUorGPU",
          "requiredNodeTags": "vmaf"
        }
      },
      {
        "name": "Mark Step: on vmaf node",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "id": "z0PJChPzq",
        "position": {
          "x": 132,
          "y": 60
        },
        "fpEnabled": true,
        "inputsDB": {
          "label": "vmaf-node"
        }
      },
      {
        "name": "Check Video Resolution",
        "sourceRepo": "Community",
        "pluginName": "checkVideoResolution",
        "version": "1.0.0",
        "id": "8LBmnwQp2",
        "position": {
          "x": 132,
          "y": 108
        },
        "fpEnabled": true
      },
      {
        "name": "Check 10 Bit Video",
        "sourceRepo": "Community",
        "pluginName": "check10Bit",
        "version": "1.0.0",
        "id": "Zq6686zJq",
        "position": {
          "x": 48,
          "y": 204
        },
        "fpEnabled": true
      },
      {
        "name": "Run VMAF Quality Check (10 bit)",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "id": "ByHvEfNeU",
        "position": {
          "x": -96,
          "y": 324
        },
        "fpEnabled": true,
        "inputsDB": {
          "referenceFile": "{{{args.variables.user.videoOnlySource}}}",
          "pixelFormat": "yuv420p10le",
          "minFrameScore": "70",
          "minP1": "85",
          "tierThresholds": "better=92,75,88\nbalanced=90,70,80\nsmallest=88,60,75"
        }
      },
      {
        "name": "Run VMAF Quality Check",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "id": "q6hn0d6Rx",
        "position": {
          "x": 72,
          "y": 324
        },
        "fpEnabled": true,
        "inputsDB": {
          "referenceFile": "{{{args.variables.user.videoOnlySource}}}",
          "minFrameScore": "80",
          "minP1": "90",
          "minMean": "95",
          "tierThresholds": "better=92,75,88\nbalanced=90,70,80\nsmallest=88,60,75"
        }
      },
      {
        "name": "Run VMAF Quality Check",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "id": "Cfn1Fxrih",
        "position": {
          "x": 408,
          "y": 300
        },
        "fpEnabled": true,
        "inputsDB": {
          "referenceFile": "{{{args.variables.user.videoOnlySource}}}",
          "pixelFormat": "yuv420p",
          "model": "vmaf_4k_v0.6.1",
          "minFrameScore": "80",
          "minP1": "85",
          "tierThresholds": "better=92,75,88\nbalanced=90,70,80\nsmallest=88,60,75"
        }
      },
      {
        "name": "Run VMAF Quality Check (10-bit)",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "id": "GL2dbFCxx",
        "position": {
          "x": 240,
          "y": 288
        },
        "fpEnabled": true,
        "inputsDB": {
          "referenceFile": "{{{args.variables.user.videoOnlySource}}}",
          "pixelFormat": "yuv420p10le",
          "model": "vmaf_4k_v0.6.1",
          "minFrameScore": "80",
          "minP1": "85",
          "tierThresholds": "better=92,75,88\nbalanced=90,70,80\nsmallest=88,60,75"
        }
      },
      {
        "name": "Check 10 Bit Video (4k)",
        "sourceRepo": "Community",
        "pluginName": "check10Bit",
        "version": "1.0.0",
        "id": "McgM017uy",
        "position": {
          "x": 228,
          "y": 228
        },
        "fpEnabled": true
      },
      {
        "name": "Save Current Node",
        "sourceRepo": "Local",
        "pluginName": "saveCurrentNode",
        "version": "1.0.0",
        "id": "KdgMhwsir",
        "position": {
          "x": 828,
          "y": 24
        },
        "fpEnabled": true
      },
      {
        "name": "Set Re-Encode Offset",
        "sourceRepo": "Local",
        "pluginName": "setReEncodeOffset",
        "version": "1.0.0",
        "id": "z2cZuApwE",
        "position": {
          "x": 948,
          "y": 420
        },
        "fpEnabled": true
      },
      {
        "name": "Route to same encoder",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "id": "9T5SjM7Q6",
        "position": {
          "x": 636,
          "y": 288
        },
        "fpEnabled": true,
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "{{{args.variables.user.savedNode}}}"
        }
      },
      {
        "name": "Require Review",
        "sourceRepo": "Community",
        "pluginName": "requireReview",
        "version": "1.0.0",
        "id": "aGAurGL9m",
        "position": {
          "x": 432,
          "y": 660
        },
        "fpEnabled": true
      },
      {
        "name": "Set Working File",
        "sourceRepo": "Community",
        "pluginName": "setWorkingFile",
        "version": "1.0.0",
        "id": "g8_qHXA8W",
        "position": {
          "x": 636,
          "y": 336
        },
        "fpEnabled": true,
        "inputsDB": {
          "source": "customPath",
          "customPath": "{{{args.variables.user.videoOnlySource}}}"
        }
      },
      {
        "name": "Compare File Size To Source",
        "sourceRepo": "Local",
        "pluginName": "compareFileSizeToSource",
        "version": "1.0.0",
        "id": "Jdn7-QrUv",
        "position": {
          "x": 444,
          "y": 432
        },
        "fpEnabled": true,
        "inputsDB": {
          "referenceFile": "{{{args.variables.user.videoOnlySource}}}"
        }
      },
      {
        "name": "Compare File Size To Source",
        "sourceRepo": "Local",
        "pluginName": "compareFileSizeToSource",
        "version": "1.0.0",
        "id": "p2Dk_Y6nL",
        "position": {
          "x": 0,
          "y": 432
        },
        "fpEnabled": true,
        "inputsDB": {
          "referenceFile": "{{{args.variables.user.videoOnlySource}}}"
        }
      },
      {
        "name": "Restore original file",
        "sourceRepo": "Community",
        "pluginName": "setWorkingFile",
        "version": "1.0.0",
        "id": "e0cKHDycc",
        "position": {
          "x": 96,
          "y": 552
        },
        "fpEnabled": true,
        "inputsDB": {
          "source": "customPath",
          "customPath": "{{{args.variables.user.videoOnlySource}}}"
        }
      },
      {
        "name": "Mark step: Restored original",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "id": "UcmLCHlFV",
        "position": {
          "x": 96,
          "y": 516
        },
        "fpEnabled": true,
        "inputsDB": {
          "label": "encoder-quality-bypass"
        }
      }
    ],
    "flowEdges": [
      {
        "source": "d7QK1TBlh",
        "sourceHandle": "1",
        "target": "Y40uvSwMF",
        "targetHandle": null,
        "id": "tagToExecute"
      },
      {
        "source": "YbKi7dgS7",
        "sourceHandle": "1",
        "target": "-RGSfdo8K",
        "targetHandle": null,
        "id": "HJP6K6E5p"
      },
      {
        "source": "YbKi7dgS7",
        "sourceHandle": "2",
        "target": "tHF4vUCsM",
        "targetHandle": null,
        "id": "4DaK-Pwmt"
      },
      {
        "source": "-RGSfdo8K",
        "sourceHandle": "1",
        "target": "cnvMarkEnc",
        "targetHandle": null,
        "id": "vKgslqElF"
      },
      {
        "source": "FAc9QeWJK",
        "sourceHandle": "1",
        "target": "qualOffset",
        "targetHandle": null,
        "id": "faE1dVp4J"
      },
      {
        "source": "EuW3bnW-x",
        "sourceHandle": "2",
        "target": "Rn3WUT-NN",
        "targetHandle": null,
        "id": "BKx9P5i9u"
      },
      {
        "source": "Rn3WUT-NN",
        "sourceHandle": "1",
        "target": "N2YufVfRT",
        "targetHandle": null,
        "id": "_AT4rG44X"
      },
      {
        "source": "tHF4vUCsM",
        "sourceHandle": "1",
        "target": "7D1MRCH2-",
        "targetHandle": null,
        "id": "OoKwvGsGw"
      },
      {
        "source": "EuW3bnW-x",
        "sourceHandle": "1",
        "target": "wEp4vfM6B",
        "targetHandle": null,
        "id": "8eTBTou_k"
      },
      {
        "source": "8V9_07K-F",
        "sourceHandle": "1",
        "target": "qualOffset",
        "targetHandle": null,
        "id": "PlS1fiYxS"
      },
      {
        "source": "wEp4vfM6B",
        "sourceHandle": "2",
        "target": "8V9_07K-F",
        "targetHandle": null,
        "id": "Gpdeh9ofI"
      },
      {
        "source": "wEp4vfM6B",
        "sourceHandle": "1",
        "target": "FAc9QeWJK",
        "targetHandle": null,
        "id": "KlaZJdm3S"
      },
      {
        "source": "ehGAkWvj7",
        "sourceHandle": "1",
        "target": "iIepjcd-i",
        "targetHandle": null,
        "id": "FGHzvB2k7"
      },
      {
        "source": "iIepjcd-i",
        "sourceHandle": "1",
        "target": "EuW3bnW-x",
        "targetHandle": null,
        "id": "tI2qp0lle"
      },
      {
        "source": "X4ANCc9vI",
        "sourceHandle": "1",
        "target": "YbKi7dgS7",
        "targetHandle": null,
        "id": "encEntryToFps"
      },
      {
        "source": "qualOffset",
        "sourceHandle": "1",
        "target": "Qf53O8A67",
        "targetHandle": null,
        "id": "zdvkEngS8"
      },
      {
        "source": "N2YufVfRT",
        "sourceHandle": "1",
        "target": "Qf53O8A67",
        "targetHandle": null,
        "id": "y7IbVl9dA"
      },
      {
        "source": "v27whxM07",
        "sourceHandle": "1",
        "target": "z0PJChPzq",
        "targetHandle": null,
        "id": "eGX6EwnC0"
      },
      {
        "source": "z0PJChPzq",
        "sourceHandle": "1",
        "target": "8LBmnwQp2",
        "targetHandle": null,
        "id": "cSJ5LYsE0"
      },
      {
        "source": "8LBmnwQp2",
        "sourceHandle": "1",
        "target": "Zq6686zJq",
        "targetHandle": null,
        "id": "FXrFsGnq3"
      },
      {
        "source": "8LBmnwQp2",
        "sourceHandle": "2",
        "target": "Zq6686zJq",
        "targetHandle": null,
        "id": "8qcV0VUYQ"
      },
      {
        "source": "8LBmnwQp2",
        "sourceHandle": "3",
        "target": "Zq6686zJq",
        "targetHandle": null,
        "id": "L13kFUlEt"
      },
      {
        "source": "8LBmnwQp2",
        "sourceHandle": "4",
        "target": "Zq6686zJq",
        "targetHandle": null,
        "id": "Luxg3PGTl"
      },
      {
        "source": "Zq6686zJq",
        "sourceHandle": "1",
        "target": "ByHvEfNeU",
        "targetHandle": null,
        "id": "NPNSlVvjJ"
      },
      {
        "source": "Zq6686zJq",
        "sourceHandle": "2",
        "target": "q6hn0d6Rx",
        "targetHandle": null,
        "id": "6ZqS8C_oA"
      },
      {
        "source": "8LBmnwQp2",
        "sourceHandle": "7",
        "target": "McgM017uy",
        "targetHandle": null,
        "id": "qQ-MOf7ys"
      },
      {
        "source": "8LBmnwQp2",
        "sourceHandle": "6",
        "target": "McgM017uy",
        "targetHandle": null,
        "id": "prvN1ZHQn"
      },
      {
        "source": "8LBmnwQp2",
        "sourceHandle": "5",
        "target": "Zq6686zJq",
        "targetHandle": null,
        "id": "M5S-VYEw4"
      },
      {
        "source": "8LBmnwQp2",
        "sourceHandle": "8",
        "target": "Zq6686zJq",
        "targetHandle": null,
        "id": "BbnTzUiUM"
      },
      {
        "source": "8LBmnwQp2",
        "sourceHandle": "9",
        "target": "Zq6686zJq",
        "targetHandle": null,
        "id": "OCnrsc-ga"
      },
      {
        "source": "McgM017uy",
        "sourceHandle": "1",
        "target": "GL2dbFCxx",
        "targetHandle": null,
        "id": "x8CM2tA73"
      },
      {
        "source": "McgM017uy",
        "sourceHandle": "2",
        "target": "Cfn1Fxrih",
        "targetHandle": null,
        "id": "M3MpdSezz"
      },
      {
        "source": "Y40uvSwMF",
        "sourceHandle": "1",
        "target": "v27whxM07",
        "targetHandle": null,
        "id": "KNz16ANgp"
      },
      {
        "source": "7D1MRCH2-",
        "sourceHandle": "1",
        "target": "KdgMhwsir",
        "targetHandle": null,
        "id": "W1Adc4Zgi"
      },
      {
        "source": "cnvMarkEnc",
        "sourceHandle": "1",
        "target": "KdgMhwsir",
        "targetHandle": null,
        "id": "pcMARTmK3"
      },
      {
        "source": "KdgMhwsir",
        "sourceHandle": "1",
        "target": "ehGAkWvj7",
        "targetHandle": null,
        "id": "idElLzB92"
      },
      {
        "source": "yCde19y26",
        "sourceHandle": "1",
        "target": "aGAurGL9m",
        "targetHandle": null,
        "id": "s7qgaC2-p"
      },
      {
        "source": "aGAurGL9m",
        "sourceHandle": "1",
        "target": "b8n51xYj4",
        "targetHandle": null,
        "id": "1UdTL-Ojl"
      },
      {
        "source": "cnvMarkEncDone",
        "sourceHandle": "1",
        "target": "7OnFaYshn",
        "targetHandle": null,
        "id": "6twQt9c9s"
      },
      {
        "source": "7OnFaYshn",
        "sourceHandle": "1",
        "target": "yCde19y26",
        "targetHandle": null,
        "id": "3G4fsH-Bc"
      },
      {
        "source": "9T5SjM7Q6",
        "sourceHandle": "1",
        "target": "g8_qHXA8W",
        "targetHandle": null,
        "id": "rnRne17Yx"
      },
      {
        "source": "Qf53O8A67",
        "sourceHandle": "1",
        "target": "z2cZuApwE",
        "targetHandle": null,
        "id": "jmP_-ppau"
      },
      {
        "source": "z2cZuApwE",
        "sourceHandle": "1",
        "target": "d7QK1TBlh",
        "targetHandle": null,
        "id": "seFX9PWoG"
      },
      {
        "source": "g8_qHXA8W",
        "sourceHandle": "1",
        "target": "ehGAkWvj7",
        "targetHandle": null,
        "id": "t-fM3-JOB"
      },
      {
        "source": "ByHvEfNeU",
        "sourceHandle": "2",
        "target": "Jdn7-QrUv",
        "targetHandle": null,
        "id": "CG4oW-5Ob"
      },
      {
        "source": "q6hn0d6Rx",
        "sourceHandle": "2",
        "target": "Jdn7-QrUv",
        "targetHandle": null,
        "id": "wfLCn376M"
      },
      {
        "source": "GL2dbFCxx",
        "sourceHandle": "2",
        "target": "Jdn7-QrUv",
        "targetHandle": null,
        "id": "yzJC6rrIF"
      },
      {
        "source": "Cfn1Fxrih",
        "sourceHandle": "2",
        "target": "Jdn7-QrUv",
        "targetHandle": null,
        "id": "DXYPKHagW"
      },
      {
        "source": "Jdn7-QrUv",
        "sourceHandle": "1",
        "target": "9T5SjM7Q6",
        "targetHandle": null,
        "id": "Mg9jezosp"
      },
      {
        "source": "ByHvEfNeU",
        "sourceHandle": "1",
        "target": "p2Dk_Y6nL",
        "targetHandle": null,
        "id": "_pLRBp54n"
      },
      {
        "source": "q6hn0d6Rx",
        "sourceHandle": "1",
        "target": "p2Dk_Y6nL",
        "targetHandle": null,
        "id": "yG8PRueKI"
      },
      {
        "source": "GL2dbFCxx",
        "sourceHandle": "1",
        "target": "p2Dk_Y6nL",
        "targetHandle": null,
        "id": "Ut-_7ZYil"
      },
      {
        "source": "Cfn1Fxrih",
        "sourceHandle": "1",
        "target": "p2Dk_Y6nL",
        "targetHandle": null,
        "id": "ufD7TdRIe"
      },
      {
        "source": "p2Dk_Y6nL",
        "sourceHandle": "1",
        "target": "cnvMarkEncDone",
        "targetHandle": null,
        "id": "zyDudFjTr"
      },
      {
        "source": "p2Dk_Y6nL",
        "sourceHandle": "2",
        "target": "UcmLCHlFV",
        "targetHandle": null,
        "id": "bjjkSYDB9"
      },
      {
        "source": "Jdn7-QrUv",
        "sourceHandle": "2",
        "target": "UcmLCHlFV",
        "targetHandle": null,
        "id": "_HWmWHcno"
      },
      {
        "source": "UcmLCHlFV",
        "sourceHandle": "1",
        "target": "e0cKHDycc",
        "targetHandle": null,
        "id": "nu2eINn0e"
      },
      {
        "source": "z2cZuApwE",
        "sourceHandle": "2",
        "target": "UcmLCHlFV",
        "targetHandle": null,
        "id": "FoC4a8hJw"
      },
      {
        "source": "e0cKHDycc",
        "sourceHandle": "1",
        "target": "Z8P_D62AP",
        "targetHandle": null,
        "id": "HfxUnD_ak"
      },
      {
        "source": "nEHxHExS_",
        "sourceHandle": "1",
        "target": "aixyWixBS",
        "targetHandle": null,
        "id": "vJQCb9lWF"
      },
      {
        "source": "-VSvE2yuT",
        "sourceHandle": "1",
        "target": "nEHxHExS_",
        "targetHandle": null,
        "id": "itxC1zUMb"
      },
      {
        "source": "Z8P_D62AP",
        "sourceHandle": "1",
        "target": "-VSvE2yuT",
        "targetHandle": null,
        "id": "6KrMKZcQ7"
      }
    ]
  });
exports.details = details;
